# Delivery: màn hình robot trên tablet/điện thoại

Cập nhật ngày 10/11/2026. Màn hình **Vận chuyển** đọc nhiệm vụ thật, hiển thị QR do BE cấp và chuyển trạng thái theo BE. Tablet là màn hình quan sát; Raspberry Pi vẫn là thiết bị thực thi di chuyển và cơ cấu khóa.

## 1. Các thành phần và đường truyền

```text
Staff app ──HTTPS + tài khoản Staff──> BE trên DuckDNS
  tạo delivery → submit → theo dõi Job → quét QR → xác nhận hàng/cửa/khóa

Robot app trên tablet ──mã ghép nối──> Delivery bridge trên laptop/Pi
                                     ├─ account token: đọc Job, Delivery, Endpoint
                                     └─ device token: đọc QR của robot được cấu hình
                                                │
                                                ▼
                                  https://mediassistrover.duckdns.org
                                                │
                                  lệnh thực thi / kết quả bước
                                                │
                                                ▼
                                        Pi / cơ cấu robot
```

Bridge là chương trình Node mới trong `tools/delivery-bridge.mjs`, không phải API mới đã deploy trên DuckDNS. Lý do cần bridge: API hiện công bố QR cho Device nhưng chưa công bố đầy đủ API Device để tablet tìm Job hiện tại và đọc toàn bộ bước của một nhiệm vụ do Staff tạo. Bridge dùng **các API đã có**; không thay BE và không tiêu thụ hàng đợi lệnh của Pi.

Bridge chỉ cho tablet đọc snapshot của **một robot cố định**. Tài khoản Staff/Admin dùng đọc BE và Device secret ở máy chạy bridge, không truyền chúng vào bundle tablet. Bridge có gọi API đăng nhập để lấy token, nhưng không có route tạo Job, xác thực Staff, mở khóa hay hoàn tất bước.

### Các API được dùng

| Nơi gọi | API | Mục đích |
|---|---|---|
| Bridge | `POST /api/v1/auth/login`, `GET /api/v1/auth/me` | Phiên tài khoản được phép đọc nhiệm vụ |
| Bridge | `POST /api/v1/pi/auth/token` | Phiên Device đúng robot đã cấu hình |
| Bridge | `GET /api/v1/jobs?robotId=…&status=…` | Tìm delivery đang chạy/chờ, trong quyền của tài khoản đọc |
| Bridge | `GET /api/v1/jobs/{jobId}` | Job, selected step và bước thực thi |
| Bridge | `GET /api/v1/delivery-requests/{requestId}` | Thông tin hàng, người nhận, mốc nhận/giao |
| Bridge | `GET /api/v1/endpoints/{endpointId}` | Tên điểm lấy/giao hàng |
| Bridge | `GET /api/v1/pi/jobs/{jobId}/qr-challenge` | QR hiện hành; có thể trả 204 khi không ở bước xác thực |
| Tablet | `GET <bridge>/delivery/snapshot` | Snapshot hiển thị, header `X-MAR-Display-Key` |

Danh sách Job chịu quyền của tài khoản đọc: **không thấy delivery không đồng nghĩa robot đang rảnh**. Cần tài khoản có quyền xem các delivery được giao cho robot này. Nếu một Staff chỉ thấy các yêu cầu trong phạm vi của mình, bridge cũng chỉ thấy phần đó. Không tự nâng quyền. API snapshot hỗ trợ `?jobId=<UUID>` cho kiểm tra kỹ thuật, nhưng vẫn kiểm tra quyền và robot; giao diện chính tự tìm nhiệm vụ.

## 2. Chạy thử với laptop và tablet

### Bước A — chuẩn bị cấu hình bridge

Trong PowerShell:

```powershell
cd 'D:\Robot app'
npm ci
if (-not (Test-Path -LiteralPath '.env.delivery-bridge')) {
  Copy-Item -LiteralPath '.env.delivery-bridge.example' -Destination '.env.delivery-bridge'
}
notepad .env.delivery-bridge
```

Điền những giá trị thực tế do người quản lý BE/robot cấp:

| Biến | Giá trị cần điền |
|---|---|
| `MAR_BACKEND_URL` | `https://mediassistrover.duckdns.org` — không thêm `/api/v1` |
| `MAR_ROBOT_ID` | UUID của robot được điều phối nhiệm vụ |
| `MAR_ROBOT_CODE`, `MAR_DEVICE_SECRET` | Danh tính Device của chính robot đó |
| `MAR_VIEWER_USERNAME`, `MAR_VIEWER_PASSWORD` | Tài khoản ACTIVE được đọc các Job của robot |
| `MAR_VIEWER_ACCESS_TOKEN` | Tùy chọn thay tài khoản/mật khẩu bằng access token ngắn hạn; để trống khi dùng username/password |
| `MAR_DELIVERY_PAIRING_KEY` | Chuỗi ngẫu nhiên ít nhất 32 ký tự, chỉ cấp cho màn hình của robot |
| `MAR_DELIVERY_HOST`, `MAR_DELIVERY_PORT` | Mặc định `127.0.0.1`, `8790`; dùng `0.0.0.0` để tablet truy cập qua LAN |

Có thể tạo mã ghép nối trong terminal riêng bằng `[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')`, rồi điền vào file và màn hình tablet. Không đưa file này lên Git hoặc dùng tiền tố `EXPO_PUBLIC_` cho các bí mật. File thật đã được gitignore.

Mặc định bridge chỉ mở loopback. Cho tablet truy cập LAN:

- Ưu tiên cấu hình `MAR_DELIVERY_TLS_CERT` và `MAR_DELIVERY_TLS_KEY` là đường dẫn chứng thư/khóa TLS. Chứng thư phải được tablet tin cậy; địa chỉ truy cập phải khớp chứng thư.
- Khi thử trong **LAN tin cậy**, có thể đặt `MAR_DELIVERY_HOST=0.0.0.0` và `MAR_DELIVERY_ALLOW_LAN_HTTP=true`. Cách này truyền mã ghép nối/dữ liệu qua HTTP trong LAN, chỉ phù hợp thử nghiệm. Không mở port ra Internet.
- Nếu chạy Robot bằng trình duyệt, thêm chính xác origin của trang, ví dụ `http://192.168.1.20:8082`, vào `MAR_DELIVERY_ALLOWED_ORIGINS`. Không dùng `*`. Trang HTTPS cần bridge HTTPS để tránh mixed content. Expo Go native không gửi Origin như trình duyệt.
- Cho phép cổng đã chọn qua firewall trên mạng nội bộ nếu đang bị chặn. Không cần thay BE DuckDNS.

### Bước B — chạy bridge và hai app

Terminal 1, giữ chạy:

```powershell
cd 'D:\Robot app'
npm run delivery:bridge
```

Terminal 2, Robot app:

```powershell
cd 'D:\Robot app'
npm start -- --port 8082
```

Terminal 3, Staff app:

```powershell
cd 'D:\UI app'
npm ci
npm start -- --port 8081
```

Mở các bundle bằng Expo Go/build tương thích SDK của repo. Staff hiện cấu hình nền tảng Android/iOS; không dùng web để thay bài kiểm tra camera native. Có thể xem Robot trên web bằng `npm run web -- --port 8082`.

Tablet và máy bridge cần liên lạc được qua LAN. Trong Robot app → **Vận chuyển** → nhập địa chỉ bridge, ví dụ `http://192.168.1.20:8790`, và mã ghép nối. `127.0.0.1` trên tablet là chính tablet, không phải laptop. Lấy IP LAN thực tế của máy bridge bằng `ipconfig`; địa chỉ ví dụ phải thay.

Mã ghép nối hiện chỉ giữ trong bộ nhớ app; đóng app hoàn toàn thì nhập lại. Có thể đặt riêng địa chỉ không bí mật `EXPO_PUBLIC_DELIVERY_BRIDGE_URL` để điền sẵn URL; khởi động lại Metro sau khi đổi env. Dừng từng terminal bằng `Ctrl+C`.

### Chạy bridge trên Pi

Bridge không cần ROS hay truy cập mic/camera. Cài Node có `fetch` và `AbortSignal.timeout` (Node 22 LTS phù hợp), clone/pull repo rồi:

```bash
cd /duong-dan/FE_ROBOT_INTERFACE
cp -n .env.delivery-bridge.example .env.delivery-bridge
# Điền cấu hình riêng bằng trình soạn thảo; dùng đường dẫn chứng thư kiểu Linux.
node tools/delivery-bridge.mjs
```

Bridge dùng module có sẵn trong Node nên riêng tiến trình này không cần cài Expo/node_modules. Tablet trỏ tới IP/DNS của Pi thay vì laptop. **Đây không thay thế executor trên Pi**: Pi vẫn cần bản chương trình thực thi tương thích workflow và xác thực Staff của BE.

## 3. Trạng thái màn hình lấy từ đâu?

| Hiển thị | Bằng chứng BE |
|---|---|
| Chờ điều phối | Job QUEUED/ACCEPTED |
| Đến điểm gửi / đang vận chuyển | MOVE đang RUNNING; mốc `pickedUpAt` phân biệt hai chặng |
| Chờ người gửi/người nhận xác thực | Selected AUTHENTICATE RUNNING, method QR_CODE, đúng purpose |
| Đang mở khóa | CONTROL_HARDWARE / UNLOCK_COMPARTMENT |
| Chờ đặt hàng / lấy hàng | HANDLE_PAYLOAD / LOAD hoặc UNLOAD |
| Chờ đóng cửa / kiểm tra khóa | INTERACT CLOSE/VERIFY hoặc CONTROL_HARDWARE / LOCK_COMPARTMENT |
| Giao hàng thành công | Job SUCCEEDED **và** request COMPLETED **và** có `deliveredAt` |
| Cần xử lý sự cố / hủy / lỗi | Trạng thái và interruption/cancel của BE |

QR chỉ hiển thị khi đúng Job, selected step, purpose và chưa hết hạn. Mất kết nối, hết hạn, chuyển nền hoặc kết thúc nhiệm vụ thì ẩn QR. Không tự tạo mã mới hoặc tự báo mở cửa thành công. Robot app poll khoảng 2,5 giây khi hoạt động, 5 giây khi chưa có nhiệm vụ; lỗi mạng tăng khoảng chờ tối đa 15 giây. Vì vậy đổi trạng thái có độ trễ polling, không phải video realtime.

Chế độ **Chỉ hiển thị QR theo Job ID** là phương án kỹ thuật giới hạn dùng client Device hiện có. Nó không tự tìm nhiệm vụ, không có đầy đủ người gửi/nhận hay tiến độ. Với tablet riêng, dùng **bridge** như hướng dẫn này; không nhúng Device secret thật vào bundle công khai.

## 4. Kiểm chứng và giới hạn hiện tại

Đã kiểm tra public OpenAPI và health của server ngày 10/11/2026; health trả UP, API Job không đăng nhập trả 401. Đây chưa phải bằng chứng hoàn thành một delivery thật. Trang `delivery-qr.html` minh họa cả hợp đồng riêng, không phải API để nhúng nguyên trang vào hai app. Không trộn QR Staff-hiển-thị/Pi-quét với QR Robot-hiển-thị/Staff-quét trong cùng bước.

Đã chạy typecheck, test Robot và test bridge. Bản web Robot export thành công. Kiểm tra giao diện bằng mock HTTP riêng xác nhận QR hiện ở bước người gửi và biến mất ở trạng thái giao thành công. Ảnh mock không phải bằng chứng unlock thật.

```powershell
npm run check:delivery
```

Chưa có tài khoản đọc, danh tính robot thực và Pi tại chỗ để xác minh E2E có xác thực trên server. Trước vận hành cần chạy chuỗi người gửi → người nhận trong `docs/DELIVERY_INTEGRATION.md` của repo Staff (`D:\UI app`). Nếu Pi mới chỉ ACK điều khiển servo mà chưa có bằng chứng vật lý BE yêu cầu, BE có thể từ chối bước tiếp theo; không sửa UI thành thành công giả để bỏ qua.

Lỗi thường gặp: 401/403 → kiểm tra phiên/quyền/robot; không có Job → kiểm tra đúng robot và phạm vi viewer; có nhiều Job đang thực thi → xử lý điều phối; QR trống → kiểm tra selected AUTH QR_CODE và thời hạn; web không kết nối → kiểm tra URL LAN, origin, TLS/firewall; tablet và bridge lệch giờ lớn → đồng bộ giờ.
