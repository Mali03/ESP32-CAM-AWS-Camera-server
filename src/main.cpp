#include <Arduino.h>
#include "esp_camera.h"
#include "esp_wifi.h"
#include <WiFi.h>
#include <WebSocketsClient.h>

#define CAMERA_MODEL_AI_THINKER

#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27

#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

// WiFi credentials
const char *ssid = "*******";
const char *password = "*******";

// AWS WebSocket server
const char *aws_host = "**.**.**.**";
const uint16_t aws_port = 8080;
const char *aws_path = "/";

static camera_config_t camera_config = {
    .pin_pwdn = PWDN_GPIO_NUM,
    .pin_reset = RESET_GPIO_NUM,
    .pin_xclk = XCLK_GPIO_NUM,
    .pin_sscb_sda = SIOD_GPIO_NUM,
    .pin_sscb_scl = SIOC_GPIO_NUM,

    .pin_d7 = Y9_GPIO_NUM,
    .pin_d6 = Y8_GPIO_NUM,
    .pin_d5 = Y7_GPIO_NUM,
    .pin_d4 = Y6_GPIO_NUM,
    .pin_d3 = Y5_GPIO_NUM,
    .pin_d2 = Y4_GPIO_NUM,
    .pin_d1 = Y3_GPIO_NUM,
    .pin_d0 = Y2_GPIO_NUM,
    .pin_vsync = VSYNC_GPIO_NUM,
    .pin_href = HREF_GPIO_NUM,
    .pin_pclk = PCLK_GPIO_NUM,

    .xclk_freq_hz = 24000000,
    .ledc_timer = LEDC_TIMER_0,
    .ledc_channel = LEDC_CHANNEL_0,

    .pixel_format = PIXFORMAT_JPEG,
    .frame_size = FRAMESIZE_QVGA, // 320x240 QQVGA -> 160x120

    .jpeg_quality = 28, // 0-63 lower number means higher quality
    .fb_count = 1,      // if more than one, i2s runs in continuous mode. Use only with JPEG
    .fb_location = CAMERA_FB_IN_PSRAM,
    .grab_mode = CAMERA_GRAB_LATEST,
};

WebSocketsClient webSocket;
static bool g_socket_connected = false;

static bool init_camera()
{
  esp_err_t err = esp_camera_init(&camera_config);
  if (err != ESP_OK)
  {
    Serial.printf("Camera init failed with error 0x%x\n", err);
    return false;
  }
  return true;
}

static void on_websocket_event(WStype_t type, uint8_t *payload, size_t length)
{
  (void)payload;
  (void)length;

  if (type == WStype_CONNECTED)
  {
    g_socket_connected = true;
    Serial.println("WebSocket connected");
  }
  else if (type == WStype_DISCONNECTED)
  {
    g_socket_connected = false;
    Serial.println("WebSocket disconnected");
  }
}

void setup()
{
  Serial.begin(115200);
  Serial.setDebugOutput(true);

  while (!Serial)
    ;

  if (!init_camera())
  {
    Serial.println("Failed to initialize Camera!");
  }
  else
  {
    Serial.println("Camera initialized");
  }

  sensor_t *s = esp_camera_sensor_get();
  s->set_framesize(s, FRAMESIZE_QVGA);
  s->set_quality(s, 28);
  s->set_brightness(s, 0);
  s->set_contrast(s, 0);
  s->set_saturation(s, 0);
  s->set_gainceiling(s, GAINCEILING_8X);

  WiFi.begin(ssid, password);
  WiFi.setSleep(false);
  esp_wifi_set_ps(WIFI_PS_NONE);

  Serial.print("WiFi connecting");
  while (WiFi.status() != WL_CONNECTED)
  {
    delay(500);
    Serial.print(".");
  }
  Serial.println("");
  Serial.println("WiFi connected");

  webSocket.begin(aws_host, aws_port, aws_path);
  webSocket.onEvent(on_websocket_event);
  webSocket.setReconnectInterval(5000);
}

void loop()
{
  webSocket.loop();

  static unsigned long last_send = 0;
  if (!g_socket_connected)
  {
    delay(10);
    return;
  }

  if (millis() - last_send > 50)
  {
    last_send = millis();

    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb)
    {
      Serial.println("Camera capture failed");
      return;
    }

    webSocket.sendBIN(fb->buf, fb->len);
    esp_camera_fb_return(fb);
  }
}