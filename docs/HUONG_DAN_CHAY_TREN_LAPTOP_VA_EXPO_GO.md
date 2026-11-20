# Hướng dẫn cấu hình & chạy App trên Laptop + quét QR bằng Expo Go trên điện thoại

Tài liệu này giải thích **vì sao bạn của bạn pull code về chạy trên điện thoại bị lỗi không đăng nhập / không xác thực được**, cần sửa gì trước khi chạy trên laptop, và các bước mở bằng Expo Go trên điện thoại.

---

## 1. Vì sao pull code về chạy trên điện thoại bị lỗi không đăng nhập / không xác thực được?

### A. Đối với App Robot (`FE_ROBOT_INTERFACE` / thư mục `Robot app`)
Ứng dụng màn hình Robot **không có màn hình đăng nhập username/password** như app nhân viên, mà tự động xác thực thiết bị với máy chủ bằng biến môi trường trong `.env`:

1. **Thiếu file `.env` sau khi `git pull` / `git clone`:**
   - File `.env` và `.env.delivery-bridge` nằm trong `.gitignore` nên **không được đưa lên GitHub**.
   - Nếu máy bạn của bạn chưa có `.env`, [src/services/api/config.ts](../src/services/api/config.ts) sẽ tự dùng giá trị mặc định:
     - `EXPO_PUBLIC_ROBOT_CODE` -> fallback về `'ROBOT_MAR_01'` (sai so với robot đang dùng trên server DuckDNS là `mar-v1`).
     - `EXPO_PUBLIC_ROBOT_ID` -> rỗng `''`.
     - `EXPO_PUBLIC_DEVICE_TOKEN` -> rỗng `''`.
   - Khi app gọi `POST https://mediassistrover.duckdns.org/api/v1/pi/auth/token` với `ROBOT_MAR_01`, server trả về **`HTTP 401: Robot code hoặc device secret không hợp lệ`**.
   - Ngoài ra, [src/config/env.ts](../src/config/env.ts) đặt `useMock` mặc định `true` nếu chưa set `EXPO_PUBLIC_USE_MOCK=false`.

2. **File `.env` cũ còn trỏ nhầm về `localhost:8080`:**
   - `.env.example` đã trỏ về HTTPS và robot `mar-v1`. File `.env` đã tạo trước đó cần cập nhật riêng; copy/pull code không tự thay các biến này.
   - Khi mở bằng Expo Go trên điện thoại thật, `config.ts` tự thay `localhost` thành IP LAN của laptop (hoặc host tunnel nếu chạy `--tunnel`). Nếu laptop bạn của bạn **không chạy Backend local cổng 8080**, mọi kết nối sẽ bị **`fetch failed`** hoặc hết thời gian chờ.
   - Ví dụ log `http://10.3.68.63:8080` có thể xuất phát từ `localhost` trong `.env`, không phải server HTTPS. Kiểm tra URL ngay trong log `[API AUTH]`.
   - Native fetch có thể trả `TypeError: Fetch request has been canceled` khi hết thời gian chờ. Client phân biệt timeout do timer của app với hủy từ caller bằng `AbortSignal`; không dựa riêng vào tên lỗi `AbortError`.
   - Sau khi sửa URL/mã robot, nếu API trả `401` thì cần device secret đúng của robot đó. Đổi map/phòng hoặc tăng timeout không sửa được lỗi xác thực này. Không cần tạo một SOS thật để kiểm tra token.

3. **Device JWT (`EXPO_PUBLIC_DEVICE_TOKEN`) bị hết hạn sau 1 giờ:**
   - Trong [src/services/api/client.ts](../src/services/api/client.ts), app kiểm tra hạn `exp` của `EXPO_PUBLIC_DEVICE_TOKEN`.
   - Nếu dùng token dán tay thì token chỉ có hiệu lực khoảng **1 giờ** (ví dụ token `mar-v1` dùng trước đó đã hết hạn lúc `17:05:40 +07:00` ngày `15/11/2026`). Khi token hết hạn, app sẽ tự gọi lại `POST /api/v1/pi/auth/token` bằng `EXPO_PUBLIC_ROBOT_CODE` + `EXPO_PUBLIC_ROBOT_SECRET`; nếu `EXPO_PUBLIC_ROBOT_SECRET` không khớp secret thật của `mar-v1` trên BE thì vẫn báo lỗi `401`.

4. **Tài khoản Viewer đọc bản đồ trong `robotMapService.ts`:**
   - [src/services/api/robotMapService.ts](../src/services/api/robotMapService.ts) gọi `POST https://mediassistrover.duckdns.org/api/v1/auth/login` (mặc định tài khoản `admin` / `1234567891011`) để tải map và snapshot robot `0e3f1083-2546-4f45-8004-5eda5cb75a6f`. Máy điện thoại phải ra được Internet tới `mediassistrover.duckdns.org` và tài khoản này phải còn hoạt động trên server.

---

## 2. Cần chuẩn bị / sửa gì TRƯỚC khi chạy trên laptop bạn của bạn?

### Bước 1: Pull code mới nhất & cài dependencies
Mở PowerShell / Terminal tại thư mục dự án trên laptop bạn của bạn:

```powershell
git pull origin main
npm install
```

> Khuyến nghị cài **Node.js 20 LTS hoặc 22 LTS**.

### Bước 2: Tạo file `.env` ở thư mục gốc của project
Tạo file mới tên là `.env` (cùng cấp với `package.json`), dán nội dung sau và **điền đúng secret hoặc token còn hạn**:

```dotenv
EXPO_PUBLIC_USE_MOCK=false
EXPO_PUBLIC_ROBOT_API_URL=https://mediassistrover.duckdns.org
EXPO_PUBLIC_ROBOT_CODE=mar-v1
EXPO_PUBLIC_ROBOT_ID=0e3f1083-2546-4f45-8004-5eda5cb75a6f

# CÁCH 1 (Khuyên dùng - chạy lâu dài không hết hạn mỗi giờ):
# Điền đúng Device Secret của robot mar-v1 do quản lý BE cấp
EXPO_PUBLIC_ROBOT_SECRET=<DIEN_DEVICE_SECRET_CUA_MAR_V1>

# CÁCH 2 (Tạm thời nếu chưa có Device Secret):
# Dán Device JWT mới xin từ BE (chỉ sống ~1 giờ). Nếu đã dùng Cách 1 thì bỏ trống hoặc xóa dòng này.
# EXPO_PUBLIC_DEVICE_TOKEN=<DIEN_DEVICE_JWT_CON_HAN>
```

> **Lưu ý bảo mật:**
> - **KHÔNG** gửi file `.env` có chứa secret/token lên GitHub (`git status` không bao giờ được hiện `.env`).
> - Không đặt `EXPO_PUBLIC_ROBOT_API_URL=http://localhost:8080` trừ khi chính laptop đó đang chạy Backend Spring Boot / Docker ở cổng `8080` và mở cho LAN truy cập.

### Bước 3: Kiểm tra phiên bản Expo Go & giờ hệ thống trên điện thoại
- File [package.json](../package.json) sử dụng **`expo: ^58.0.0`** (`react-native: 0.88.0`). Điện thoại phải cài **Expo Go tương thích Expo SDK 58**.
- Đảm bảo **ngày giờ trên điện thoại và laptop chính xác** (tránh lệch giờ làm JWT bị coi là hết hạn).
- Đảm bảo điện thoại mở được `https://mediassistrover.duckdns.org` (có kết nối Internet).

---

## 3. Cách chạy trên Laptop và quét QR trên điện thoại

> **Bắt buộc:** Mỗi lần tạo mới hoặc sửa file `.env`, **phải tắt Metro (`Ctrl + C`) và chạy kèm `--clear`** để Expo nạp biến `EXPO_PUBLIC_*` mới vào bundle.

### Cách A — Dùng chung Wi-Fi LAN (nhanh nhất, ổn định nếu Wi-Fi không chặn LAN)
1. Kết nối **laptop và điện thoại vào cùng một mạng Wi-Fi** (khuyên dùng Wi-Fi nhà riêng hoặc phát hotspot từ điện thoại; nhiều Wi-Fi trường/quán cafe bật chặn giao tiếp nội bộ).
2. Chạy trên laptop:
   ```powershell
   npx expo start --go --lan --clear
   ```
3. Nếu Windows Firewall hỏi quyền cho **Node.js**, chọn **Allow** (cho phép cả Private/Public nếu cần test nhanh).
4. Quét mã QR trên terminal bằng điện thoại:
   - **Android:** Mở app **Expo Go** -> chọn **Scan QR code**.
   - **iOS (iPhone/iPad):** Mở app **Camera** mặc định -> hướng vào mã QR -> chạm thông báo để mở trong **Expo Go**.

### Cách B — Dùng Tunnel (khi khác Wi-Fi hoặc Wi-Fi trường/quán cafe chặn quét QR LAN)
1. Chạy trên laptop:
   ```powershell
   npx expo start --go --tunnel --clear
   ```
   *(Nếu Expo hỏi cài `@expo/ngrok`, chọn `Y` để cài).*
2. Đợi xuất hiện mã QR mới rồi quét bằng **Expo Go** / **Camera iOS**.
3. **Quan trọng:** Khi dùng `--tunnel`, file `.env` **bắt buộc phải để `EXPO_PUBLIC_ROBOT_API_URL=https://mediassistrover.duckdns.org`** (nếu để `http://localhost:8080` sẽ bị hỏng URL khi điện thoại chạy qua tunnel).

---

## 4. Nếu bạn cần test thêm tab "Vận chuyển" (`QrDeliveryMissionScreen`)

Màn hình **Vận chuyển** lấy danh sách nhiệm vụ & mã QR từ **Delivery Bridge** chạy trên laptop (hoặc Pi):

1. Tạo `.env.delivery-bridge` từ mẫu [.env.delivery-bridge.example](../.env.delivery-bridge.example):
   ```powershell
   Copy-Item -LiteralPath '.env.delivery-bridge.example' -Destination '.env.delivery-bridge'
   ```
2. Sửa các biến trong `.env.delivery-bridge`:
   - `MAR_BACKEND_URL=https://mediassistrover.duckdns.org`
   - `MAR_ROBOT_ID=0e3f1083-2546-4f45-8004-5eda5cb75a6f`
   - `MAR_ROBOT_CODE=mar-v1`
   - `MAR_DEVICE_SECRET=<DEVICE_SECRET_MAR_V1>`
   - `MAR_VIEWER_USERNAME` / `MAR_VIEWER_PASSWORD`: tài khoản hợp lệ trên BE được xem job của robot.
   - `MAR_DELIVERY_PAIRING_KEY`: chuỗi ngẫu nhiên tối thiểu 32 ký tự.
   - `MAR_DELIVERY_HOST=0.0.0.0`
   - `MAR_DELIVERY_PORT=8790`
   - `MAR_DELIVERY_ALLOW_LAN_HTTP=true` *(chỉ dùng khi test HTTP trong mạng LAN tin cậy)*.
3. Mở Windows Firewall cho cổng `8790` (hoặc chạy PowerShell Admin cho phép TCP `8790` trong LAN).
4. Chạy bridge ở **Terminal 1**:
   ```powershell
   npm run delivery:bridge
   ```
5. Chạy Expo ở **Terminal 2**:
   ```powershell
   npx expo start --go --lan --clear --port 8082
   ```
6. Lấy IP LAN của laptop bằng lệnh `ipconfig` (ví dụ `192.168.1.20`). Trên điện thoại vào tab **Vận chuyển** -> nhập URL `http://<IP_LAN_LAPTOP>:8790` và mã `MAR_DELIVERY_PAIRING_KEY`. *(Chi tiết xem thêm [DELIVERY_INTEGRATION.md](DELIVERY_INTEGRATION.md)).*

---

## 5. Lưu ý nếu bạn của bạn đang chạy App Nhân viên (`FE_APP_MAR`)

Nếu thực chất bạn của bạn đang chạy **App Staff (`FE_APP_MAR`)** — ứng dụng **có màn hình Đăng nhập tài khoản/mật khẩu** — và bị không đăng nhập được trên điện thoại:

1. Kiểm tra đã `git pull` đúng nhánh `main` (tránh nhánh cũ mặc định `localhost:8080`).
2. Kiểm tra trong máy không có file `.env` đặt `EXPO_PUBLIC_API_BASE_URL` trỏ về `http://localhost:8080/api/v1` (mặc định khi bỏ trống `EXPO_PUBLIC_API_BASE_URL` là `https://mediassistrover.duckdns.org/api/v1`).
3. Trên màn hình **Đăng nhập** của app Staff, bấm biểu tượng **Cài đặt (bánh răng)** ở góc trên bên phải -> chọn preset **`https://mediassistrover.duckdns.org/api/v1`** -> bấm **Kiểm tra kết nối** để xác nhận ra `HTTP 200`, sau đó mới đăng nhập bằng tài khoản nhân viên còn hoạt động trên server.

---

## 6. Bảng xử lý lỗi nhanh

| Triệu chứng / Thông báo lỗi | Nguyên nhân | Cách khắc phục |
|---|---|---|
| `HTTP 401: Robot code hoặc device secret không hợp lệ` | Thiếu `.env` (dùng nhầm `ROBOT_MAR_01`), sai `EXPO_PUBLIC_ROBOT_SECRET`, hoặc chưa `--clear` sau khi sửa `.env` | Tạo đúng `.env` với `mar-v1` + secret thật -> chạy `npx expo start --go --lan --clear` |
| `[API AUTH] Token cấu hình đã hết hạn` | `EXPO_PUBLIC_DEVICE_TOKEN` chỉ sống ~1 giờ và đã quá hạn | Xóa `EXPO_PUBLIC_DEVICE_TOKEN` và điền `EXPO_PUBLIC_ROBOT_SECRET` thật (hoặc xin JWT mới), rồi khởi động lại với `--clear` |
| `fetch failed` / `http://172.x.x.x:8080` hoặc `http://localhost:8080` | `.env` đang để `localhost:8080` mà laptop không bật BE local | Đổi `EXPO_PUBLIC_ROBOT_API_URL=https://mediassistrover.duckdns.org`, chạy lại với `--clear` |
| Quét QR xong quay mãi / `Could not connect to development server` | Khác Wi-Fi, Wi-Fi bật AP Isolation chặn LAN, hoặc Windows Firewall chặn Metro (`8081`) | Đưa 2 máy về cùng Wi-Fi / Hotspot, tắt chặn Firewall cho Node.js hoặc chạy `npx expo start --go --tunnel --clear` |
| Expo Go báo không tương thích SDK | Expo Go trên điện thoại quá cũ hoặc quá mới so với project (`expo ^58.0.0`) | Cập nhật/cài đúng **Expo Go hỗ trợ SDK 58** |
