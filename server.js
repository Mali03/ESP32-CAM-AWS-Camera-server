const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

let clients = [];
let sessions = {};
let ADMIN_USER = 'admin';
let ADMIN_PASS = '1234';

function parseBody(req, cb) {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => cb(new URLSearchParams(body)));
}

function isAuthorized(req) {
  const auth = req.headers['authorization'] || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (bearer && sessions[bearer]) return true;

  const url = new URL(req.url, 'http://x');
  const token = url.searchParams.get('token');
  if (token && sessions[token]) return true;

  return false;
}

function renderLoginPage() {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Login - ESP32 Camera</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        }
        .container {
          background: white;
          padding: 40px;
          border-radius: 10px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
          width: 100%;
          max-width: 400px;
        }
        .logo { text-align: center; margin-bottom: 30px; }
        .logo h1 { color: #333; font-size: 28px; margin-bottom: 10px; }
        .logo p { color: #666; font-size: 14px; }
        .form-group { margin-bottom: 20px; }
        label {
          display: block;
          margin-bottom: 8px;
          color: #333;
          font-weight: 500;
          font-size: 14px;
        }
        input[type="text"],
        input[type="password"] {
          width: 100%;
          padding: 12px;
          border: 2px solid #ddd;
          border-radius: 5px;
          font-size: 14px;
          transition: border-color 0.3s;
          font-family: inherit;
        }
        input[type="text"]:focus,
        input[type="password"]:focus {
          outline: none;
          border-color: #667eea;
          box-shadow: 0 0 5px rgba(102, 126, 234, 0.3);
        }
        button {
          width: 100%;
          padding: 12px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 5px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
          margin-top: 10px;
        }
        button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
        }
        button:active:not(:disabled) { transform: translateY(0); }
        button:disabled { opacity: 0.6; cursor: not-allowed; }
        .error {
          background: #fee;
          color: #c33;
          padding: 10px;
          border-radius: 5px;
          margin-bottom: 20px;
          display: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">
          <h1>Camera Login</h1>
          <p>Please sign in to continue</p>
        </div>
        <div id="errorMsg" class="error"></div>
        <form onsubmit="handleLogin(event)">
          <div class="form-group">
            <label for="username">Username</label>
            <input type="text" id="username" name="username" required>
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" required>
          </div>
          <button type="submit" id="loginBtn">Login</button>
        </form>
      </div>
      <script>
        function handleLogin(event) {
          event.preventDefault();
          const username = document.getElementById("username").value;
          const password = document.getElementById("password").value;
          const loginBtn = document.getElementById("loginBtn");
          const errorMsg = document.getElementById("errorMsg");
          loginBtn.disabled = true;
          loginBtn.textContent = "Connecting...";
          fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ username, password })
          })
          .then(r => r.json())
          .then(data => {
            if (data.success) {
              localStorage.setItem("isLoggedIn", "true");
              localStorage.setItem("authToken", data.token);
              window.location.href = "/cam?token=" + encodeURIComponent(data.token);
            } else {
              errorMsg.textContent = data.message || "Login failed";
              errorMsg.style.display = "block";
              loginBtn.disabled = false;
              loginBtn.textContent = "Login";
            }
          })
          .catch(() => {
            errorMsg.textContent = "Connection error";
            errorMsg.style.display = "block";
            loginBtn.disabled = false;
            loginBtn.textContent = "Login";
          });
        }
        window.addEventListener("load", function () {
          const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
          const token = localStorage.getItem("authToken");
          if (isLoggedIn && !token) {
            localStorage.removeItem("isLoggedIn");
            localStorage.removeItem("authToken");
          }
        });
      </script>
    </body>
    </html>
  `;
}

function renderDashboardPage() {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>ESP32 Camera Stream</title>
      <style>
        body {
          margin: 0;
          padding: 20px;
          background: #1a1a1a;
          color: #fff;
          font-family: Arial, sans-serif;
          text-align: center;
        }
        h1 { color: #4CAF50; }
        .navbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding: 15px;
          background: #222;
          border-radius: 5px;
        }
        img {
          max-width: 100%;
          height: auto;
          border: 3px solid #4CAF50;
          border-radius: 8px;
        }
        .change-container {
          max-width: 420px;
          margin: 20px auto;
          padding: 15px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.03);
          text-align: left;
        }
        .change-container label {
          display: block;
          margin-bottom: 6px;
          color: #ccc;
          font-size: 14px;
        }
        .change-container input {
          width: 100%;
          padding: 10px;
          border-radius: 6px;
          border: 1px solid #333;
          background: #111;
          color: #fff;
          margin-bottom: 10px;
        }
        .change-container button {
          width: 100%;
          padding: 12px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border: none;
          color: #fff;
          border-radius: 6px;
          cursor: pointer;
        }
      </style>
    </head>
    <body>
      <div class="navbar">
        <h1>Camera Stream</h1>
      </div>
      <img id="stream" alt="Stream">
      <div class="change-container">
        <h2 style="color:#fff;font-size:18px;margin:0 0 10px 0">Change Password</h2>
        <label for="newPassword">New Password</label>
        <input type="password" id="newPassword" placeholder="Enter new password">
        <button id="changePwdBtn" onclick="handleChangePassword()">Change Password</button>
        <div id="changeMsg" style="margin-top:10px;color:#fff;display:none;"></div>
      </div>
      <script>
        let ws;
        function checkAuth() {
          const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
          const token = localStorage.getItem("authToken");
          if (!isLoggedIn || !token) {
            window.location.href = "/";
            return false;
          }
          return true;
        }
        function connectStream() {
          if (!checkAuth()) return;
          ws = new WebSocket("ws://" + location.host);
          ws.binaryType = "arraybuffer";
          ws.onmessage = e => {
            const img = document.getElementById("stream");
            img.src = URL.createObjectURL(new Blob([e.data], { type: "image/jpeg" }));
          };
          ws.onclose = () => setTimeout(connectStream, 2000);
        }
        function handleChangePassword() {
          if (!checkAuth()) return;
          const btn = document.getElementById("changePwdBtn");
          const msg = document.getElementById("changeMsg");
          const newPwd = document.getElementById("newPassword").value;
          if (!newPwd) { msg.style.display = "block"; msg.textContent = "Enter a new password"; return; }
          btn.disabled = true; btn.textContent = "Changing...";
          const token = localStorage.getItem("authToken");
          fetch("/api/change_password", {
            method: "POST",
            headers: {
              "Authorization": "Bearer " + token,
              "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({ new_password: newPwd })
          })
          .then(r => r.json())
          .then(data => {
            btn.disabled = false;
            btn.textContent = "Change Password";
            msg.style.display = "block";
            msg.textContent = data.message || "Updated";
          })
          .catch(() => {
            btn.disabled = false;
            btn.textContent = "Change Password";
            msg.style.display = "block";
            msg.textContent = "Request failed";
          });
        }
        window.addEventListener("load", connectStream);
      </script>
    </body>
    </html>
  `;
}

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, {'Content-Type':'text/html'});
    res.end(renderLoginPage());
  }

  else if (req.url === '/login' && req.method === 'POST') {
    parseBody(req, p => {
      if (p.get('u') === ADMIN_USER && p.get('p') === ADMIN_PASS) {
        const token = crypto.randomBytes(16).toString('hex');
        sessions[token] = true;
        res.writeHead(302, { Location: '/cam?token=' + token });
        res.end();
      } else {
        res.end('Login failed');
      }
    });
  }

  else if (req.url.startsWith('/cam')) {
    const token = new URL(req.url,'http://x').searchParams.get('token');
    if (!sessions[token]) { res.end('Unauthorized'); return; }

    res.writeHead(200,{'Content-Type':'text/html'});
    res.end(renderDashboardPage());
  }

  else if (req.url === '/api/login' && req.method === 'POST') {
    parseBody(req, p => {
      if (p.get('username') === ADMIN_USER && p.get('password') === ADMIN_PASS) {
        const token = crypto.randomBytes(16).toString('hex');
        sessions[token] = true;
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ success: true, token }));
      } else {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ success: false, message: 'Invalid username or password' }));
      }
    });
  }

  else if (req.url === '/api/change_password' && req.method === 'POST') {
    if (!isAuthorized(req)) {
      res.writeHead(401, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
      return;
    }
    parseBody(req, p => {
      const newPwd = p.get('new_password');
      if (!newPwd) {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ success: false, message: 'New password required' }));
        return;
      }
      ADMIN_PASS = newPwd;
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ success: true, message: 'Password updated' }));
    });
  }
});

const wss = new WebSocket.Server({server});
wss.on('connection', ws=>{
  ws.on('message', data=>{
    wss.clients.forEach(c=>{
      if(c.readyState===1) c.send(data);
    });
  });
});

server.listen(8080, ()=>console.log('Aws server ready.'));
