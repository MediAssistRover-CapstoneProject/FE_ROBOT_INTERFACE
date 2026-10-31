# Kết nối API robot

Đây là **hợp đồng API đề xuất cho lớp tích hợp**, chưa phải API đã được bệnh viện hoặc nhóm robot triển khai. Các URL, phòng khám, lộ trình và phản hồi mẫu trong dự án chỉ phục vụ phát triển giao diện. Cần thống nhất hợp đồng với nhóm backend trước khi bật kết nối thật.

## Chế độ dữ liệu

Mặc định ứng dụng kết nối trực tiếp đến **Backend Local** trên máy tính qua cổng `8080` (hoặc chuyển sang chế độ Hybrid Fallback khi database trống):

```dotenv
EXPO_PUBLIC_USE_MOCK=false
EXPO_PUBLIC_ROBOT_API_URL=http://localhost:8080
EXPO_PUBLIC_ROBOT_CODE=ROBOT_MAR_01
EXPO_PUBLIC_ROBOT_SECRET=6rGL6RPV9VgbVZfmcHXmA2uz-oST8speM1bO1eI1ozg
EXPO_PUBLIC_ROBOT_ID=278e1751-36cd-4e24-bb1d-1c151b2396db
```

Để chuyển hoàn toàn sang dữ liệu mô phỏng không cần bật Docker Backend, đặt:

```dotenv
EXPO_PUBLIC_USE_MOCK=true
```

Thay địa chỉ ví dụ bằng máy chủ thật. Điện thoại phải truy cập được địa chỉ này; `localhost` trên iPhone là chính điện thoại. Dùng HTTPS với chứng chỉ hợp lệ khi triển khai. Sau khi đổi biến môi trường, khởi động lại Expo.

Các biến có tiền tố `EXPO_PUBLIC_` được đưa vào mã ứng dụng và **không giữ bí mật**. Không đặt mật khẩu, API key hoặc access token trong các biến này.

## Cách gọi từ giao diện

```ts
import {
  isDemoMode,
  robotService,
  RobotServiceError,
} from '../services/robot';

try {
  const status = await robotService.getStatus();
  // Hiển thị trạng thái được máy chủ xác nhận.
} catch (error) {
  if (error instanceof RobotServiceError) {
    // error.message đã bằng tiếng Việt.
    // error.requestId có thể dùng để đối chiếu nhật ký backend.
  }
}
```

`src/services/robot/index.ts` chọn adapter mẫu hoặc API. Các màn hình chỉ phụ thuộc `RobotService`, không gọi `fetch` trực tiếp. `isDemoMode` cần được dùng để gắn nhãn rõ các thao tác mẫu, đặc biệt điều hướng và SOS.

Backend có thể yêu cầu xác thực bằng cách cung cấp hàm lấy access token:

```ts
const service = createApiRobotService({
  baseUrl: env.robotApiUrl,
  robotId: env.robotId,
  getAccessToken: async () => authProvider.getAccessToken(),
});
```

`authProvider` là điểm tích hợp cần triển khai khi có hệ thống đăng nhập thật, không phải module đã có trong dự án. Token chỉ được đưa vào header `Authorization: Bearer …`, không được ghi vào log bởi adapter.

## Quy ước chung

- Body và phản hồi dùng JSON trực tiếp, không bọc trong trường `data`.
- Thành công trả mã HTTP `2xx` kèm JSON đúng kiểu. Kể cả thao tác dừng cũng phải trả trạng thái tác vụ; `204` không đủ để giao diện xác nhận.
- Mã robot và tác vụ được mã hóa an toàn khi đưa vào URL.
- Mọi request có `X-Request-ID`; POST có thêm `Idempotency-Key` cùng giá trị.
- Backend cần lưu kết quả theo `Idempotency-Key` để xử lý trùng lặp. Adapter tạo key mới cho mỗi lần gọi; việc người dùng bấm thử lại là yêu cầu mới. Không coi key phía client là bảo đảm tự động chống trùng khi backend chưa hỗ trợ.
- Adapter **không tự thử lại**, đặc biệt với lệnh di chuyển, dừng và SOS. Giao diện nên khóa nút trong lúc gửi.
- Thời gian chờ mặc định 12 giây, bao gồm lấy token, gửi request và đọc JSON. Khi hết thời gian, adapter hủy request phía client và báo chưa xác nhận được kết quả. Việc hủy request không bảo đảm máy chủ chưa thực hiện lệnh.
- Không lưu hàng đợi lệnh để tự gửi khi có mạng lại.
- Không dùng app này thay cho mạch dừng khẩn cấp của robot.

## Các endpoint đề xuất

### Đọc trạng thái robot

`GET /robots/{robotId}/status`

```json
{
  "id": "MAR-01",
  "name": "Robot hỗ trợ ngoại trú",
  "battery": 86,
  "location": "Sảnh tiếp đón",
  "availability": "available"
}
```

`battery`: số từ 0 đến 100. `availability`: `available`, `busy` hoặc `offline`. Nếu không đọc được trạng thái, giao diện không nên suy ra robot sẵn sàng từ dữ liệu cũ.

### Danh sách điểm đến

`GET /destinations`

```json
[
  {
    "id": "reception",
    "name": "Quầy tiếp đón",
    "category": "service",
    "floor": "Tầng trệt",
    "description": "Hướng dẫn đăng ký khám."
  }
]
```

`category`: `clinic`, `lab`, `pharmacy`, `payment` hoặc `service`. `floor` là chuỗi hiển thị bằng tiếng Việt. Mỗi điểm đến phải có `id` riêng.

### Bắt đầu chỉ đường hoặc dẫn đường

`POST /robots/{robotId}/navigation`

```json
{
  "destinationId": "reception",
  "mode": "directions"
}
```

`mode=directions`: chỉ hiển thị hướng dẫn. `mode=escort`: đề nghị robot dẫn đường. Backend cần kiểm tra robot, khu vực hoạt động, khả năng di chuyển và quyền của phiên trước khi nhận lệnh dẫn đường.

Phản hồi:

```json
{
  "id": "nav-001",
  "destinationId": "reception",
  "destinationName": "Quầy tiếp đón",
  "mode": "directions",
  "status": "active",
  "steps": ["Bắt đầu tại sảnh tiếp đón.", "Đến quầy tiếp đón."],
  "currentStep": 0
}
```

`status`: `pending`, `active`, `blocked`, `stopped` hoặc `arrived`. `currentStep` là chỉ số bắt đầu từ 0 trong `steps`; khi chưa có bước nào, `steps=[]` và `currentStep=0`. Việc robot đã đến nơi chỉ được xác nhận bằng trạng thái backend `arrived`, không bằng bộ đếm thời gian ở giao diện.

### Đọc tiến độ

`GET /navigation/{taskId}`

Trả về đối tượng tác vụ như trên. Giao diện có thể đọc định kỳ khi màn hình tác vụ đang mở; cần ngừng khi rời màn hình hoặc tác vụ kết thúc. Adapter từ chối phản hồi nếu `id` không khớp tác vụ được yêu cầu. Khi bắt đầu hành trình, `destinationId` và `mode` trong phản hồi cũng phải khớp yêu cầu.

### Khôi phục hành trình đang hoạt động

`GET /robots/{robotId}/navigation/active`

Phương thức adapter: `getActiveNavigation(): Promise<NavigationTask | null>`.

Trả JSON đối tượng tác vụ hiện hành với trạng thái `pending`, `active` hoặc `blocked`. Trả HTTP `200` với body JSON `null` khi backend đã xác nhận robot không có hành trình đang hoạt động. `404`, lỗi mạng và timeout là lỗi tra cứu, không được hiểu thành không có hành trình.

Giao diện gọi endpoint này khi mở ứng dụng trong chế độ thật và sau khi gửi lệnh điều hướng bị timeout/mất kết nối trước khi nhận `taskId`. Nếu kết quả chưa xác định, giữ trạng thái chưa xác nhận và không tự gửi thêm lệnh. Backend phải xử lý kiểm tra/nhận hành trình mới theo thứ tự và ngăn hai hành trình hoạt động đồng thời trên cùng robot, kể cả khi request trước vẫn đang xử lý. Endpoint tra cứu theo request ID là phần mở rộng có thể bổ sung để đối chiếu chính xác yêu cầu trước đó.

### Dừng tác vụ

`POST /navigation/{taskId}/stop`, body `{}`.

Trả về đối tượng tác vụ với trạng thái được backend xác nhận. Nếu trả `pending` hoặc `active`, giao diện phải tiếp tục chờ/kiểm tra; không tự hiển thị robot đã dừng. Lệnh này là yêu cầu dừng hành trình qua mạng, không thay thế nút dừng khẩn cấp vật lý.

### Hỏi thông tin bệnh viện

`POST /assistant/messages`

```json
{
  "robotId": "MAR-01",
  "message": "Tôi đăng ký khám ở đâu?"
}
```

```json
{
  "message": "Vui lòng đến quầy tiếp đón để được hướng dẫn đăng ký khám."
}
```

Câu hỏi được loại bỏ khoảng trắng đầu/cuối; tối đa 2.000 ký tự. Trợ lý mẫu chỉ trả lời thông tin, thủ tục và điểm đến minh họa. Việc chẩn đoán, kê đơn hoặc đánh giá triệu chứng không thuộc phạm vi bản mẫu. Backend thật cần có nguồn thông tin được bệnh viện phê duyệt.

### Yêu cầu hỗ trợ khẩn cấp

`POST /robots/{robotId}/sos`, body `{}`.

```json
{
  "id": "sos-001",
  "status": "received",
  "createdAt": "2026-10-20T03:00:00.000Z"
}
```

`received` chỉ xác nhận hệ thống nhận yêu cầu, không khẳng định nhân viên đã đọc hay đang đến. Thông tin định tuyến, vị trí robot và nhóm tiếp nhận phải do backend quản lý. Không truyền thông tin bệnh nhân qua biến môi trường.

Khi offline, timeout, lỗi HTTP hoặc JSON không hợp lệ, adapter **báo lỗi**, không trả biên nhận giả và không chuyển sang mock. Giao diện cần ghi rõ chưa xác nhận gửi thành công và hướng dẫn liên hệ trực tiếp nhân viên gần nhất.

Trong mock, biên nhận có `id=demo-sos-*` và không được gửi ra ngoài. Giao diện cần hiển thị “Mô phỏng — chưa thông báo nhân viên”.

## Lỗi và kiểm tra dữ liệu

Adapter trả `RobotServiceError` gồm:

- `code`: `configuration`, `validation`, `network`, `timeout`, `unauthorized`, `not_found`, `conflict`, `server` hoặc `invalid_response`.
- `message`: thông báo tiếng Việt để hiển thị.
- `requestId`: mã đối chiếu nếu đã bắt đầu request.
- `httpStatus`: mã HTTP nếu lỗi từ máy chủ.

Không hiển thị raw body từ backend. Adapter kiểm tra các trường bắt buộc, enum, mức pin, ID điểm đến trùng, chỉ số bước điều hướng và thời gian biên nhận SOS. Backend vẫn chịu trách nhiệm xác thực, phân quyền, giới hạn lệnh và kiểm tra an toàn vật lý.

## Kiểm thử

`tests/robot.test.ts` kiểm tra request/response, mã hóa đường dẫn, idempotency headers, timeout và hủy request, lỗi offline của SOS, dữ liệu sai định dạng, tính độc lập của các phiên mock và việc mock không tự xác nhận robot đã tới nơi. Các kiểm thử không gọi robot hoặc máy chủ thật.
