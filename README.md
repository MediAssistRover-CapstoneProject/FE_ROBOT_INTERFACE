# MediAssist Rover - Robot Touchscreen Interface (FE_ROBOT_INTERFACE)

> **Delivery cập nhật 10/11/2026:** tablet hiển thị QR do BE cấp, Staff quét và xác nhận giao nhận theo từng bước. Xem [cách chạy bridge, hai app và nghiệm thu](docs/DELIVERY_INTEGRATION.md). Màn hình delivery chính đã thay demo bằng trạng thái BE; các mô tả delivery cũ bên dưới không phải hướng dẫn cho luồng mới.

> **Giao diện Màn hình Cảm ứng (Touchscreen HMI)** gắn trực tiếp trên Robot Y tế Phục vụ Bệnh viện Thông minh **MediAssist Rover (MAR)**.  
> **Phiên bản:** Expo SDK 58.0.0 · React Native 0.88.0 · React 19.3.0 · TypeScript 6.0 · Vitest · Kết nối Local Spring Boot Backend (Port 8080).

---

## 1. TỔNG QUAN HỆ THỐNG

Ứng dụng **MediAssist Rover (Robot Interface)** là phân hệ giao diện cảm ứng trung tâm được cài đặt trực tiếp trên màn hình robot (Raspberry Pi / x86 Tablet gắn trên thân robot). Hệ thống thực hiện 4 nhóm nhiệm vụ y tế chủ đạo:

1. **Tiếp đón & Hỗ trợ Bệnh nhân Ngoại trú (Patient Outpatient Hub):**
   - Tra cứu phòng khám, nhà thuốc, khu xét nghiệm trực tiếp từ máy chủ bệnh viện (`GET /api/v1/public/rooms`).
   - Sơ đồ định vị trong nhà tương tác thời gian thực (`IndoorHospitalMap`).
   - Kích hoạt chế độ **Robot Dẫn đường trực tiếp (Patient Escort)** với tốc độ an toàn (0.25 m/s) qua `POST /api/v1/pi/requests/escort`.
2. **Cấp cứu Y tế Khẩn cấp (Emergency SOS Incident):**
   - Nút ấn khẩn cấp tức thì trên màn hình hoặc lệnh thoại gửi gói tin `EMERGENCY_SOS` qua `POST /api/v1/pi/incidents/sos`.
   - Polling trạng thái điều dưỡng tiếp nhận thời gian thực qua `GET /api/v1/pi/incidents/{incidentId}`.
3. **Vận chuyển Thuốc & Vật tư Y tế (Medical Logistics & Delivery):**
   - **Vận chuyển Bảo mật (Secure QR Delivery):** Sử dụng Camera quét mã QR cá nhân của y bác sĩ để mở khóa khoang chứa thuốc (`QrDeliveryMissionScreen`).
   - **Vận chuyển Thường (Direct Handover):** Bác sĩ/điều dưỡng xác nhận nhận hàng trực tiếp trên màn hình (`NoAuthDeliveryMissionScreen`).
   - **Xử lý Sự cố Thực tế (Unhappy Cases):** Tự động phát hiện và xử lý vật cản phía trước khoảng cách 1.2m (`OBSTACLE_BLOCKED`), hết thời gian chờ nhận thuốc (`TIMEOUT_NO_RECIPIENT`), và lệnh hủy nhiệm vụ khẩn cấp quay về dock sạc (`RETURNING_TO_BASE`).
4. **Trợ lý Giọng nói & Cẩm nang Y tế (Voice Assistant & Hospital Knowledge):**
   - Tiếp nhận lệnh thoại và câu hỏi bệnh nhân gửi về máy chủ robot qua `POST /api/v1/pi/voice/commands`.
   - Cung cấp cẩm nang và quy trình khám ngoại trú lấy từ `GET /api/v1/public/hospital-information`.

---

## 2. BẢN ĐỒ CẤU TRÚC DỰ ÁN (FILE ARCHITECTURE)

```text
FE_ROBOT_INTERFACE/
├── .env                                # Biến môi trường kết nối API cục bộ (Local Backend)
├── app.json                            # Cấu hình Expo SDK 58, quyền Camera, Bundler Metro
├── package.json                        # Expo SDK 58, React Native 0.88, TypeScript, Vitest
├── vitest.config.ts                    # Cấu hình kiểm thử tự động Vitest cho React Native
├── LUONG_NGHIEP_VU_ROBOT_INTERFACE.md  # Tài liệu chi tiết toàn bộ luồng nghiệp vụ & sơ đồ tuần tự
├── src/
│   ├── app/
│   │   ├── AppNavigator.tsx            # Điều hướng phân luồng màn hình (Stack Navigator)
│   │   ├── navigation.ts               # Định nghĩa Route Param List & Type-safe navigation
│   │   └── RobotSession.tsx            # Quản lý phiên làm việc, lưu trạng thái tác vụ
│   ├── services/
│   │   ├── api/                        # TẦNG GIAO TIẾP VỚI MÁY CHỦ BACKEND (SPRING BOOT)
│   │   │   ├── config.ts               # Tự động nhận diện IP LAN (Expo Go) và localhost (Web)
│   │   │   ├── client.ts               # HTTP Client: Tự động quản lý JWT Token, header X-Request-ID
│   │   │   ├── envelope.ts             # Bộ đóng gói PiEnvelope v1.0 chuẩn giao thức Robot-Server
│   │   │   ├── robotApiService.ts      # Service trung tâm: Chứa đầy đủ các API REST
│   │   │   ├── types.ts                # Định nghĩa Typescript Interfaces đồng bộ với Swagger DTO
│   │   │   └── index.ts                # Barrel export API
│   │   └── robot/                      # LỚP ADAPTER VÀ MOCK DATA DỰ PHÒNG
│   │       ├── api.ts                  # Adapter gọi API cũ
│   │       ├── mock.ts                 # Dữ liệu mô phỏng ngoại trú phục vụ demo offline
│   │       └── types.ts                # Định nghĩa kiểu dữ liệu nghiệp vụ
│   ├── features/                       # MÀN HÌNH CHỨC NĂNG CHÍNH
│   │   ├── home/HomeScreen.tsx         # Màn hình chính: Trạng thái robot, 4 tác vụ nhanh, dock điều hướng
│   │   ├── patient/PatientHubScreen.tsx# [Nghiệp vụ 1] Tra cứu khoa phòng & Robot dẫn đường
│   │   ├── emergency/SosCallScreen.tsx # [Nghiệp vụ 2] Báo động cấp cứu SOS, Polling trạng thái
│   │   ├── logistics/
│   │   │   ├── QrDeliveryMissionScreen.tsx     # [Nghiệp vụ 3] Vận chuyển thuốc quét mã QR 5 bước
│   │   │   └── NoAuthDeliveryMissionScreen.tsx # [Nghiệp vụ 4] Vận chuyển thường & Xử lý vật cản
│   │   ├── assistant/AssistantScreen.tsx       # [Nghiệp vụ 5] Hỏi trợ lý giọng nói & văn bản
│   │   ├── information/InformationScreen.tsx   # [Nghiệp vụ 6] Tra cứu cẩm nang & bài viết bệnh viện
│   │   └── navigation/NavigationScreen.tsx     # Xem bản đồ và lộ trình di chuyển chi tiết
│   ├── components/                     # CÁC THÀNH PHẦN GIAO DIỆN TÁI SỬ DỤNG
│   │   ├── IndoorHospitalMap.tsx       # Bản đồ định vị trong nhà (Indoor Vector/SVG Map)
│   │   ├── LogisticsStepper.tsx        # Thanh tiến trình các bước nạp/giao hàng
│   │   └── ui.tsx                      # Button, Card, Notice, AppText chuẩn giao diện y tế
│   └── theme/index.ts                  # Hệ thống màu sắc y tế chuẩn Navy/Teal/Red SOS
└── tests/
    ├── robot.test.ts                   # 27 tests: Kiểm thử luồng adapter robot và mock
    └── robotApiService.test.ts         # 17 tests: Kiểm thử ApiClient, PiEnvelope và RobotApiService
```

---

## 3. DANH MỤC API BACKEND ĐÃ TÍCH HỢP

Tất cả các API dưới đây đã được kết nối và xác thực thành công với **Local Spring Boot Backend** trên cổng `8080`:

| Nhóm nghiệp vụ | Phương thức & Endpoint | Chức năng nghiệp vụ | Xác thực |
| :--- | :--- | :--- | :---: |
| **Xác thực thiết bị** | `POST /api/v1/pi/auth/token` | Lấy Device JWT Token cho robot (`ROBOT_MAR_01`) | Không |
| **Nhịp tim Telemetry** | `POST /api/v1/pi/heartbeat` | Báo cáo mức pin, trạng thái hoạt động (IDLE, BUSY) | Bearer Token |
| **Tọa độ Realtime** | `POST /api/v1/pi/telemetry/location` | Báo cáo tọa độ `xM`, `yM`, góc quay `yawRad` | Bearer Token |
| **Danh mục Khoa phòng**| `GET /api/v1/public/rooms` | Lấy danh sách 6 phòng khám thực tế | Không |
| **Khu vực & Sơ đồ** | `GET /api/v1/public/zones` | Lấy danh mục các zone trong bệnh viện | Không |
| **Tầng lầu** | `GET /api/v1/public/floors` | Lấy thông tin các tầng lầu | Không |
| **Bài viết Bệnh viện** | `GET /api/v1/public/hospital-information` | Lấy 7 bài viết cẩm nang khám bệnh ngoại trú | Không |
| **Hộ tống Dẫn đường** | `POST /api/v1/pi/requests/escort` | Tạo yêu cầu robot dẫn bệnh nhân đến phòng khám | Bearer Token |
| **Hủy yêu cầu** | `POST /api/v1/pi/requests/{id}/cancel` | Hủy yêu cầu dẫn đường khi bệnh nhân dừng | Bearer Token |
| **Cấp cứu SOS** | `POST /api/v1/pi/incidents/sos` | Kích hoạt báo động khẩn cấp gửi điều dưỡng | Bearer Token |
| **Theo dõi Cấp cứu** | `GET /api/v1/pi/incidents/{id}` | Polling nhận phản hồi tiếp nhận từ điều dưỡng | Bearer Token |
| **Bắt đầu Job Giao hàng**| `POST /api/v1/pi/jobs/{id}/started` | Khởi động nhiệm vụ vận chuyển thuốc | Bearer Token |
| **Bắt đầu Step** | `POST /api/v1/pi/job-steps/{id}/started` | Đánh dấu bắt đầu từng chặng di chuyển | Bearer Token |
| **Hoàn tất Step** | `POST /api/v1/pi/job-steps/{id}/result` | Báo cáo nạp thuốc xong, xác thực QR xong | Bearer Token |
| **Báo cáo Lỗi / Vật cản**| `POST /api/v1/pi/job-steps/{id}/errors`| Báo vật cản `OBSTACLE_BLOCKED`, hết giờ `TIMEOUT` | Bearer Token |
| **Hoàn tất Job Giao hàng**| `POST /api/v1/pi/jobs/{id}/result` | Hoàn tất biên bản giao nhận dược phẩm | Bearer Token |
| **Trợ lý Giọng nói** | `POST /api/v1/pi/voice/commands` | Gửi câu hỏi / lệnh thoại của bệnh nhân | Bearer Token |

---

## 4. HƯỚNG DẪN KHỞI CHẠY VÀ PHÁT TRIỂN

### 4.1. Khởi động Backend Spring Boot Local (Docker)
Đảm bảo máy tính đã cài đặt Docker Desktop:
```powershell
# Chuyển đến thư mục backend
cd "D:\BE_MAR"
docker compose up -d
```
Truy cập Swagger UI kiểm tra: [http://localhost:8080/swagger-ui/index.html](http://localhost:8080/swagger-ui/index.html)

### 4.2. Cấu hình Môi trường Robot App
File `.env` tại thư mục gốc:
```dotenv
EXPO_PUBLIC_ROBOT_API_URL=http://localhost:8080
EXPO_PUBLIC_ROBOT_CODE=ROBOT_MAR_01
EXPO_PUBLIC_ROBOT_SECRET=6rGL6RPV9VgbVZfmcHXmA2uz-oST8speM1bO1eI1ozg
EXPO_PUBLIC_USE_MOCK=false
```

### 4.3. Kiểm tra Mã nguồn (Typecheck & Unit Tests)
```powershell
cd "D:\Robot app"

# Kiểm tra kiểu dữ liệu TypeScript (0 lỗi)
npm run typecheck

# Chạy toàn bộ 44 Unit Tests tự động (44/44 Passed)
npm test

# Hoặc chạy kiểm tra tổng hợp:
npm run check
```

### 4.4. Khởi chạy Ứng dụng Giao diện Robot

```powershell
npm start
```

- **Chạy trên Trình duyệt Web:** Nhấn phím `w` trong terminal hoặc truy cập `http://localhost:8081`. Ứng dụng tự động kết nối API qua `http://localhost:8080`.
- **Chạy trên Điện thoại / Máy tính bảng thật (Expo Go):**
  1. Cài đặt ứng dụng **Expo Go** từ App Store (iOS) hoặc Google Play (Android).
  2. Kết nối điện thoại và máy tính vào cùng mạng Wi-Fi LAN.
  3. Quét mã QR hiển thị trên màn hình terminal để mở ứng dụng. Hệ thống tự động phân giải địa chỉ IP LAN của máy tính để gọi backend `8080` mượt mà.

---

## 5. THỰC HIỆN KIỂM THỬ ĐƠN VỊ (UNIT TESTS SUMMARY)

Hệ thống sở hữu bộ kiểm thử tự động toàn diện gồm **44 tests** (100% Passed):
- `tests/robot.test.ts` (27 tests): Kiểm thử các adapter giao tiếp, xử lý URL, xác thực đầu vào, định dạng tác vụ điều hướng, và các tình huống ngoại lệ.
- `tests/robotApiService.test.ts` (17 tests): Kiểm thử bộ đóng gói `PiEnvelope`, cơ chế cache token JWT của `ApiClient`, header `X-Request-ID` / `Idempotency-Key`, gọi API Heartbeat, Telemetry, SOS, Job Lifecycle, Unhappy Cases, Voice Commands, và Public Room Catalog.
