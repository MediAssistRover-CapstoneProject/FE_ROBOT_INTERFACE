# MediAssistRover

Project React Native + TypeScript dùng Expo Go, dành cho giao diện tương tác giữa bệnh nhân và robot hỗ trợ khoa khám bệnh ngoại trú. Đây là bộ khung chức năng để tiếp tục áp dụng bản thiết kế giao diện của bạn.

## Chạy trên iPhone

Máy đã được cài thư viện cho project này. Mở terminal tại thư mục `Robot app`:

```powershell
npm start
```

1. Cài **Expo Go** trên iPhone.
2. Kết nối máy tính và iPhone vào cùng mạng Wi-Fi.
3. Giữ terminal đang chạy, dùng **Camera iPhone** quét mã QR và chọn mở bằng Expo Go.
4. Khi sửa file trong `src`, lưu lại để giao diện cập nhật.

Mặc định chạy dữ liệu mô phỏng, không cần backend hoặc tài khoản bệnh viện. Không cần tạo `.env` để xem giao diện.

Nếu chuyển project sang máy khác, cài Node.js LTS rồi chạy `npm ci` trước `npm start`. Thư mục có dấu cách được hỗ trợ.

### Phiên bản Expo Go

Project sử dụng **Expo SDK 58**, React Native 0.88.0, React 19.3.0 tương thích trực tiếp với phiên bản Expo Go mới nhất trên iPhone và Android.
Kết nối trực tiếp đến **Backend Local** qua `http://localhost:8080` (Swagger UI: `http://localhost:8080/swagger-ui/index.html`).

- [Hướng dẫn tương thích Expo Go](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/)
- [Hướng dẫn chạy trên thiết bị](https://docs.expo.dev/get-started/start-developing/)

Nếu Expo Go yêu cầu đăng nhập, đăng nhập cùng tài khoản Expo trên điện thoại và trên máy tính bằng `npx expo login`. Không cần gửi thông tin tài khoản cho người khác.

### Khi quét mã chưa mở được app

- Cho phép Expo Go truy cập **Mạng cục bộ** trong Cài đặt iPhone.
- Máy tính và iPhone cần nhìn thấy nhau trên mạng. Mạng khách hoặc Wi-Fi bệnh viện có thể chặn kết nối giữa các thiết bị.
- Cho phép Node.js qua Windows Firewall trên mạng riêng khi Windows hỏi.
- Dừng server bằng `Ctrl+C`, thử `npm start -- --clear`.
- Nếu LAN không dùng được, chạy `npm run start:tunnel`. Expo có thể hỏi cài `@expo/ngrok`; chế độ tunnel cần Internet. Tunnel chỉ cung cấp đường vào server phát triển, không tự mở đường đến API robot trong LAN.
- `npm run web` mở bản xem thử trên trình duyệt. Đây là cách xem thêm, không thay thế kiểm tra trên iPhone.

## Chức năng hiện có

- Trang chính: 4 tác vụ nhanh, SOS và trạng thái robot.
- Tìm địa điểm: tìm kiếm tiếng Việt có/không dấu, lọc phòng khám, xét nghiệm, nhà thuốc, thanh toán và dịch vụ.
- Chỉ đường/dẫn đường: chọn điểm đến, hiển thị các bước, theo dõi trạng thái, gửi yêu cầu dừng, mở lại lộ trình đang có.
- Hỏi trợ lý: câu hỏi văn bản, gợi ý, trạng thái gửi và gửi lại khi lỗi.
- Quy trình khám: 4 bước minh họa có thể mở/thu gọn.
- SOS: gửi yêu cầu, hiển thị trạng thái đã tiếp nhận hoặc lỗi; chế độ demo luôn ghi rõ không thông báo nhân viên thật.

Toàn bộ nội dung ứng dụng bằng tiếng Việt. Giao diện dùng màu xanh dịu, nền sáng, nút lớn, vùng an toàn iPhone, nội dung cuộn và bố cục thay đổi theo chiều rộng. Không sử dụng gradient, hiệu ứng kính hoặc animation trang trí.

## Cấu trúc mã nguồn

```text
App.tsx                         Điểm vào ứng dụng
src/
  app/
    AppNavigator.tsx            Điều hướng màn hình
    navigation.ts               Kiểu tham số màn hình
    RobotSession.tsx            Lộ trình hiện tại, chống gửi lệnh trùng
  components/
    ui.tsx                      Nút, chữ, thẻ, thông báo, vùng màn hình
    ErrorBoundary.tsx           Màn hình phục hồi khi lỗi hiển thị
  theme/index.ts                Màu sắc, khoảng cách và bo góc
  config/env.ts                 Cấu hình môi trường công khai
  features/
    home/                       Trang chính
    navigation/                 Điểm đến và lộ trình
    assistant/                  Hỏi trợ lý
    information/                Quy trình khám
    emergency/                  Yêu cầu hỗ trợ
  services/robot/
    types.ts                    Hợp đồng dữ liệu và dịch vụ
    index.ts                    Chọn API thật hoặc dữ liệu mẫu
    api.ts                      HTTP, timeout, lỗi, xác thực
    mock.ts                     Mô phỏng để phát triển giao diện
    validation.ts               Kiểm tra dữ liệu backend
tests/robot.test.ts              Kiểm thử phần kết nối
docs/API.md                     Hợp đồng API đề xuất
docs/SCOPE.md                   Phạm vi trích từ tài liệu đề tài
```

Khi có bản thiết kế, sửa `src/theme`, `src/components` và màn hình trong `src/features`; giữ `src/services/robot` độc lập.

## Nối API robot

Sao chép `.env.example` thành `.env`, điền địa chỉ backend rồi đổi:

```dotenv
EXPO_PUBLIC_USE_MOCK=false
EXPO_PUBLIC_ROBOT_API_URL=http://192.168.1.10:8080/api
EXPO_PUBLIC_ROBOT_ID=MAR-01
```

Địa chỉ trên chỉ là ví dụ. Không dùng `localhost` để truy cập backend từ iPhone. Khởi động lại Expo sau khi đổi cấu hình.

Đọc [hợp đồng API](docs/API.md) trước khi kết nối. Các endpoint là đề xuất, chưa có backend thật trong project. Adapter có chỗ cấp access token qua `getAccessToken`; không lưu mật khẩu hoặc token vào `EXPO_PUBLIC_*`.

Ứng dụng kiểm tra lộ trình đang hoạt động khi mở. Nếu chưa xác nhận được kết quả gửi lệnh, ứng dụng khóa yêu cầu mới và cho kiểm tra lại với backend. Backend phải xử lý thứ tự lệnh, chống trùng và quản lý chuyển động của robot.

## Các phần chờ tích hợp

Giọng nói, camera/QR, nhận diện khuôn mặt, bản đồ thật, dữ liệu tiến độ robot, vận chuyển nội bộ, thông báo nhân viên, xác thực và cập nhật realtime chưa được triển khai. Hiện tiến độ được đọc định kỳ; có thể thay bằng WebSocket hoặc SignalR trong lớp dịch vụ sau khi thống nhất backend.

Không có màn hình nhân viên/admin trong bộ khung bệnh nhân này. Không thu thập hoặc lưu hồ sơ bệnh nhân. Bản demo không điều khiển phần cứng và không thay nút dừng khẩn cấp vật lý.

## Kiểm tra project

```powershell
npm run typecheck
npm test
npm run export
npm run doctor
```

`export` kiểm tra đóng gói cho iOS, Android và web. Việc đóng gói thành công chưa thay thế thử nghiệm trên iPhone và robot thật.
