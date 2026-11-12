# Bàn giao Antigravity · SOS một chạm và bản đồ dẫn đường

Dành cho Gemini Flash 3.8 High. Cập nhật theo workspace ngày 12/11/2026.

## Chia việc theo app

- **UI app — `D:\UI app`.** Làm **U1 · Nhận SOS và mở cuộc gọi một chạm**. Nhân viên trực thấy thẻ ở Cảnh báo, bấm “Nhận SOS · Camera và đàm thoại”, vào phiên đúng sự cố, thấy camera robot và nghe/nói hai chiều. Giữ nút micro, loa và kết thúc trong màn hình gọi.
- **Robot app — `D:\Robot app`.** Làm **R1 · Gửi SOS và hiển thị phản hồi thật** và **R2 · Bản đồ hướng dẫn đường đi**. Khi dẫn bệnh nhân, màn hình robot hiển thị bản đồ, đường Nav2, hướng rẽ, khoảng cách đến chỗ rẽ và quãng đường đến phòng. Hiển thị thời gian dự kiến khi dữ liệu tốc độ đủ tin cậy.
- **Kiểm tra phối hợp.** R1 và U1 dùng chung sự cố từ một BE. R2 dùng lộ trình dẫn đường của robot đang phục vụ bệnh nhân. Các thay đổi điều phối BE, tiến trình trên Pi và Web Admin chỉ đưa vào phạm vi nếu xác minh có phụ thuộc cần xử lý.

Trong mỗi project Antigravity, mở đúng thư mục rồi làm nhóm task ghi cho app đó. Đọc `git status --short` và `git diff` trước khi sửa. Tách diff SOS và dẫn đường để dễ kiểm tra. Bảo toàn phần QR delivery, hủy nhiệm vụ và sửa tọa độ `null` đã có trong workspace.

## Chạy bằng Expo Go

Mở hai terminal PowerShell. Nếu Antigravity đang chạy đúng bundle của app, dùng terminal đang chạy để reload. Dùng cổng riêng khi cần mở đồng thời.

**Terminal UI app / Staff**

```powershell
cd "D:\UI app"
npx expo start --go --lan --port 8081
```

**Terminal Robot app**

```powershell
cd "D:\Robot app"
npx expo start --go --lan --port 8082
```

Quét QR của từng terminal bằng Expo Go trên thiết bị cùng mạng LAN. `npm ci` chỉ dùng khi cần cài thư viện. Có thể thêm `--clear` vào lần khởi động lại nếu Expo giữ bundle cũ. Trước khi thử liên thông, đối chiếu URL BE thực sự của hai app và nguồn dữ liệu map. Chạy Metro ở cổng khác nhau vẫn có thể dùng cùng BE.

## Điểm xuất phát đã kiểm tra

- `npm run typecheck` hiện qua ở cả hai thư mục. Robot app tại commit `c4225fb` đã có lại state `isTriggeringSos`. Dùng code hiện tại làm mốc.
- Robot app vẫn gọi `triggerSos` từ cả `PatientHubScreen.tsx` và `SosCallScreen.tsx`. Màn hình SOS còn Incident ID giả và tự báo tiếp nhận sau 5 giây.
- `D:\Robot app\src\services\api\robotApiService.ts` đã bổ sung `operationKey` cho `triggerSos`, yêu cầu có Device token và Robot ID, bỏ giá trị tọa độ mặc định. Kiểm tra các call site còn lại và giữ chữ ký tương thích.
- `D:\Robot app\src\services\api\types.ts` đã bổ sung `OPEN`, `IN_PROGRESS` và `FALSE_ALARM` vào `DeviceIncidentStatusResponse`. Đối chiếu thêm `IncidentResponse` nếu cần.
- Staff đã có code nối Alert, Incident và LiveKit. Còn nút gọi trùng, nhánh lấy phiên khác sự cố và trạng thái LIVE bật trước khi thấy hình.
- Robot app đã có presentation map và lớp vẽ quỹ đạo Nav2. Hiện còn đường dự phòng tự nối điểm, mã escort sinh bằng đồng hồ và tiến độ đến nơi tăng theo timer. R2 cần thay các phần này bằng dữ liệu đúng chuyến dẫn đường.

## Robot app · R1 · Gửi SOS và báo trạng thái thật

File chính là `D:\Robot app\src\features\emergency\SosCallScreen.tsx` và `D:\Robot app\src\services\api\robotApiService.ts`.

1. Chỉ màn hình SOS gửi request. Màn hình chính chỉ điều hướng. Chặn bấm lặp và tránh gửi trùng do effect chạy lại. Một lần báo SOS dùng một `operationKey` ổn định. Nếu mất phản hồi, nút thử lại dùng lại key và payload của lần đó.
2. Dùng Device JWT từ `POST /api/v1/pi/auth/token`. Gọi `POST /api/v1/pi/incidents/sos` với envelope `EMERGENCY_SOS` và `robotId` đúng theo Device token. Lấy `incident.incidentId` từ phản hồi thành công. Chỉ gửi map và tọa độ khi có dữ liệu thật, đúng bản đồ, cả X lẫn Y hợp lệ.
3. Bỏ Incident ID tự sinh, đồng hồ tự báo điều dưỡng tiếp nhận sau 5 giây, tên nhân viên/ETA/tọa độ gắn cứng và heartbeat `IDLE` khi thoát màn hình. Tín hiệu gửi lỗi phải hiện lỗi và cách thử lại. Gửi thành công thì hiện “Đã gửi SOS · Chờ nhân viên tiếp nhận”.
4. Sau khi có Incident ID, đọc `GET /api/v1/pi/incidents/{id}` với Device JWT. Hiển thị đúng `OPEN`, `ACKNOWLEDGED`, `IN_PROGRESS` và các trạng thái kết thúc. Dừng vòng đọc khi thoát hoặc sự cố kết thúc. Trạng thái tiếp nhận sự cố và trạng thái đàm thoại là hai trạng thái riêng.
5. Xác định URL BE mà Robot app thực sự dùng. `EXPO_PUBLIC_ROBOT_API_URL` có thể đang trỏ local, còn Staff trỏ DuckDNS. Hai phía phải dùng cùng môi trường BE. Kiểm tra danh tính thiết bị qua cấu hình hiện có, giữ credential thật ngoài log và tài liệu bàn giao. Nếu giao diện chạy trên tablet riêng, rà lại chỗ giữ Device secret trước khi phân phối app.

## Robot app · R2 · Bản đồ hướng dẫn bệnh nhân

### Giao diện theo ảnh mẫu

Ảnh người dùng gửi nằm tại `C:/Users/Trung/AppData/Local/Temp/codex-clipboard-e1651a21-ca98-410d-bc64-06dff5f4e114.png`. Phần cần đưa sang Robot app là bản đồ, đường xanh và banner “Còn 43 cm, rẽ phải”. Những ô tọa độ và thao tác chỉnh endpoint trong ảnh thuộc giao diện quản trị.

- Ưu tiên bố cục ngang của tablet. Cho map chiếm phần lớn màn hình khi dẫn đường. Nền sáng, tường và phòng rõ, tên điểm đến dễ đọc.
- Trên map, dùng đường xanh đậm cho phần sắp đi, đường nhạt cho phần đã qua, mũi tên tại vị trí và hướng của robot, dấu rẽ ở ngã rẽ tiếp theo và ghim đích nổi bật. Giữ cùng phép biến đổi tọa độ cho map, pose, đường, dấu rẽ và đích. Có thể dùng nút “Về vị trí robot” nếu màn hình đang hỗ trợ pan/zoom.
- Banner xanh ở trên map có icon rẽ trái, rẽ phải, đi thẳng hoặc quay đầu và chữ lớn. Dòng chính ví dụ **“Còn 43 cm, rẽ phải”**. Dòng phụ ví dụ **“Phòng khám 2 · Còn 1,58 m”**. Khoảng cách rẽ và tổng quãng đường lấy từ hai trường riêng.
- Nếu có dữ liệu tốc độ đủ tin cậy, hiển thị **“Khoảng 3 giây nữa tới chỗ rẽ”**. Khi robot chờ, dừng, mất định vị hoặc vừa đổi đường, ẩn thời gian dự kiến và hiện trạng thái tương ứng. Nút dừng dẫn đường và SOS vẫn dễ chạm trong bố cục đang dẫn đường.

### Gắn vào luồng dẫn đường hiện có

1. Bắt đầu từ `D:\Robot app\src\features\patient\PatientHubScreen.tsx`, nơi nút dẫn đường đang gọi `handleRequestEscort`. Dùng lại `D:\Robot app\src\components\map\BackendHospitalMap.tsx` và map package trong `D:\Robot app\src\services\api\robotMapService.ts`. Rà `D:\Robot app\src\features\navigation\NavigationScreen.tsx` nếu entry point đó cũng được mở từ luồng bệnh nhân. Gắn map vào màn hình mà thao tác dẫn đường thật đi tới.
2. Khi người dùng chọn phòng, giải quyết đúng `destinationEndpointId` theo phòng và map. Với nút robot dẫn đường, dùng `POST /api/v1/pi/requests/escort` và `Idempotency-Key` của một lần bấm. Đọc `EscortResponse.request.serviceRequestId`, map và đích từ phản hồi. Khi request đã tạo, giữ ngữ cảnh chuyến dẫn đường, tránh cho đổi đích hoặc gửi chuyến thứ hai ngoài quy trình hiện có.
3. Đọc `GET /api/v1/pi/requests/{requestId}` để theo dõi status và danh sách job của chính yêu cầu. Dùng Robot ID từ Device session hoặc robot được gán cho job theo phản hồi BE. Dừng qua `POST /api/v1/pi/requests/{requestId}/cancel` với ID thật. Hiện đang chờ dừng cho đến khi có trạng thái xác nhận từ BE. Nếu mất phản hồi, đối chiếu request/job trước khi gửi lại. Thay `escort-${Date.now()}`, tăng chặng mỗi 4 giây và báo tới nơi theo timer bằng dữ liệu thực.
4. Tách trạng thái đã chọn phòng, đã gửi yêu cầu, đang chờ Nav2, đang dẫn đường và hoàn tất. Bỏ đường dự phòng tự nối pose với endpoint bằng vài điểm. Bản đồ vẫn có thể hiển thị điểm đến đã chọn trong lúc chờ đường thật. Mốc tới đích phải khớp chặng MOVE đang theo dõi. Chỉ kết thúc chuyến dẫn đường khi kết quả của request/job xác nhận hoàn tất chuyến đó.

### API và dữ liệu để hiện rẽ đúng

BE có sẵn logic tính hướng và khoảng cách. Dùng `D:\BE_MAR\BE_MAR\src\main\resources\static\map-navigation.js` làm mẫu vẽ banner, dấu rẽ và đoạn đường còn lại. Kiểm tra `NavigationGuidanceService.java` để hiểu các trường trả về và `NavigationSessionController.java` để xác định quyền gọi. Tái sử dụng thuật toán BE giúp màn hình robot đồng bộ lời hướng dẫn đang phát trên Pi.

- Map lấy từ package hiện có gồm map, metadata, endpoints, zones và presentation document. Dùng map của job/session hiện hành. So khớp `mapId`, phiên bản map hoặc `mapAssetHash` nếu có, `frameId` và hướng của trục. Giữ presentation map để vẽ, dùng tọa độ Nav2 theo mét cho pose và đường đi.
- `GET /api/v1/robots/{id}/snapshot` công bố `latestPose`, `activeJobId`, `selectedJobStepId`, `navigationSession` và `navigationPlan`. Route này dùng token tài khoản có quyền. Bỏ cách chọn robot BUSY/IDLE đầu tiên trong `loadRobotSnapshot` cho màn hình dẫn đường. Lấy snapshot của đúng robot và giữ metadata của plan để kiểm tra trước khi vẽ. Khi nguồn đọc chưa được cấp quyền cho tablet, ghi nhận vướng mắc cụ thể với BE/Pi.
- `GET /api/v1/pi/navigation-session` đọc phiên định vị của Device. Với Device đã xác thực, `POST /api/v1/pi/navigation-session/guidance` nhận `{"jobStepId":"<UUID bước MOVE hiện hành>"}`. Lấy UUID bước thật từ nguồn được phép như snapshot đúng robot hoặc ngữ cảnh bước do tiến trình Pi cung cấp. Đối chiếu `plan.jobStepId` trong response với bước đang theo dõi. API `GET /api/v1/robots/{robotId}/navigation-guidance` dùng cho Admin theo controller hiện có. Giữ quyền Device và quyền đọc của tài khoản tách riêng. Tránh nhúng thêm credential Admin hoặc Staff vào app chạy trên tablet.
- Đối chiếu response guidance với job/step, `sessionId`, map, frame và `initializationRevision`. Đọc `observedAt`, `capturedAt` và `planRevision` để biết dữ liệu còn mới. Đổi phiên, đổi map hoặc có plan mới thì cập nhật tuyến và dấu rẽ cùng lúc. Giới hạn một lượt đọc đang chạy và dừng polling khi rời màn hình, app chạy nền hoặc yêu cầu kết thúc.
- Trong `TRACKING`, ánh xạ `direction` (`LEFT`, `RIGHT`, `STRAIGHT`, `UTURN`) sang chữ/icon. `distanceCm` là khoảng cách tới thao tác kế tiếp. `remainingCm` là quãng đường còn lại dọc theo đường tới đích chặng. `turn` là điểm đặt dấu rẽ. Dùng `projection` và `segmentIndex` để tách đoạn đã đi khỏi đoạn sắp đi. Giữ đơn vị rõ, ví dụ dưới 1 m hiện cm, từ 1 m hiện mét. Lấy hướng từ guidance hoặc tọa độ map đã kiểm tra trục, vì map có thể xoay hoặc lật khi render.
- Ước tính giây tới chỗ rẽ bằng khoảng cách dọc tuyến tính theo mét chia cho tốc độ tiến dọc tuyến đã làm mượt qua nhiều mẫu cùng plan. Dùng số giây do BE cung cấp nếu hợp đồng có trường đó. Tạm ẩn ETA khi thiếu tốc độ, robot đứng yên hoặc tiến độ không ổn định. Các giá trị như `walkingSpeedMps` là cấu hình yêu cầu. Chỉ dùng để dự báo nếu ghi rõ giả định và có trạng thái robot phù hợp. Ưu tiên tốc độ đo được.
- Với `WAITING_FOR_POSE`, dữ liệu cũ hoặc thiếu đường, hiện “Đang chờ vị trí robot” hoặc “Đang lấy đường đi”. Có thể giữ nền map và ghim đích. Nếu robot đang đổi đường hoặc tạm dừng, bỏ chỉ dẫn rẽ cũ cho đến khi dữ liệu mới đúng chặng. `ARRIVED` chỉ xác nhận chặng khớp với plan. Đọc trạng thái request/job để quyết định đã xong toàn bộ chuyến.

Các route guidance xuất hiện trong OpenAPI đang deploy. Phải kiểm tra lần dẫn đường thật có navigation session và Pi publish plan cho đúng bước ESCORT/MOVE. Nếu workflow chỉ trả snapshot hoặc không có selected step, ghi rõ dữ liệu còn thiếu và màn hình hiển thị trạng thái chờ. Có thể dùng fixture có nhãn mô phỏng để duyệt UI trước khi có Pi. Nguồn tham khảo [OpenAPI BE](https://mediassistrover.duckdns.org/v3/api-docs).

## UI app · U1 · Staff nhận SOS và mở cuộc gọi một chạm

File chính là `D:\UI app\src\screens\main\AlertScreen.tsx`, `D:\UI app\src\api\modules\mediaSession.api.ts` và `D:\UI app\src\components\media\MediaCallModal.tsx`.

1. Giữ cơ chế đọc Alert/Incident hiện có để hiện thẻ trong Cảnh báo. Kiểm tra thẻ từ SOS thật, loại `SOS` hoặc `EMERGENCY_SOS`, và quyền của người trực. Phân biệt cập nhật khi màn hình đang hoạt động với thông báo khi app chạy nền. Tránh nhiều lượt polling chồng lên nhau và cập nhật từ tài khoản cũ.
2. Gom nút “Tiếp nhận SOS”, “Mở chuông SOS” và “Gọi Camera Robot” trên cùng thẻ thành **một nút gọi**. Staff đã đăng nhập dùng phiên tài khoản hiện tại. Không yêu cầu người dùng nhập token, Robot ID, Incident ID, chọn chế độ hoặc bấm accept riêng. Giữ thao tác xử lý hồ sơ sự cố và các cảnh báo AI khác theo nghiệp vụ hiện có.
3. Bấm nút thì lấy Incident ID từ đúng thẻ và Robot ID từ incident tương ứng. Nếu cần, đọc lại chi tiết incident. Kiểm tra incident chưa kết thúc và robot khớp. Xóa các fallback dùng `liveIncidents[0]`, alert đầu tiên hoặc bất kỳ phiên `RINGING` khác trong đường gọi. Gói thông tin mục tiêu vào một state duy nhất để tránh ghép nhầm robot, incident và session giữa các lần bấm.
4. Tìm phiên `ASSIST` còn mở khớp **cả `robotId` và `incidentId`**. Nếu truyền `sessionId` sẵn, đọc lại và kiểm tra nó trước khi accept. Khi chưa có phiên, có thể tạo `POST /api/v1/media-sessions` bằng đúng `{robotId, incidentId, mode: 'ASSIST'}` nếu BE cho phép. Nếu BE báo thiếu Pi, thiếu người trực hoặc xung đột, hiện lỗi của đúng sự cố. Swagger đang dùng schema `Create` trùng tên với chức năng khác, nên đối chiếu body với controller và `media-call.js`.
5. Nhận phiên qua `POST /api/v1/media-sessions/{id}/accept`, rồi `POST /api/v1/media-sessions/{id}/join-token`. Kiểm tra phiên trả về vẫn cùng robot, incident và chế độ. Thực hiện acknowledge Alert/Incident cho đúng thẻ theo trạng thái server. Đừng bỏ qua lỗi quyền và tiếp tục với phiên khác. Trạng thái “tiếp nhận hồ sơ” không xác nhận đã có hình hay tiếng. Chặn bấm kép trong khi đang mở cuộc gọi.

### Camera và âm thanh

1. Kết nối LiveKit bằng `url` và token ngắn hạn do BE cấp. Trong `MediaCallModal.tsx`, ưu tiên đưa vé LiveKit vào WebView và giữ Staff JWT ở API client của app. Nếu còn dùng HTML nhúng, giới hạn nguồn script và điều hướng WebView, mã hóa an toàn dữ liệu nhúng và dùng SDK từ máy chủ đã xác minh. Tránh đưa Staff JWT vào trang có script CDN dự phòng. Kiểm tra các màn hình dùng chung `buildMediaCallHtml` để giữ tương thích.
2. Chỉ hiển thị camera của participant `robot-<robotId>` của phiên đã chọn. Tách trạng thái “Đã vào phòng”, “Đang chờ camera” và “Đã có hình”. Nhãn LIVE phải chờ video thực sự phát. Khi mất track hoặc ngắt kết nối, cập nhật trạng thái. Đặt giới hạn thời gian chờ hình đầu để người dùng biết cần thử lại.
3. Tự phát audio robot và thử bật micro Staff ở `ASSIST`. Chỉ báo “Mic bật” sau khi lệnh bật thành công. Hiện rõ lỗi quyền micro, lỗi phát tiếng hoặc chưa nhận được audio track. Cho phép người dùng cấp quyền/thử lại trong cùng màn hình. Xác minh Android/iOS thực tế trước khi kết luận Expo Go hỗ trợ đầy đủ.
4. Nút kết thúc gửi `/media-sessions/{id}/end` cho đúng phiên rồi dọn track, room và polling. Bảo đảm một lần đóng chỉ có một yêu cầu kết thúc. Nếu BE chưa xác nhận kết thúc, báo trạng thái đó. Việc kết thúc cuộc gọi giữ riêng với việc giải quyết incident.

## Kiểm tra phối hợp · BE định tuyến và Pi phát media

- Đọc `D:\BE_MAR\BE_MAR\src\main\java\com\mediassistrover\backend\service\impl\EmergencyServiceImpl.java`, `SosResponderRouting.java` và `media\MediaSessionService.java`. Source local tạo incident, tìm người trực, tạo Alert và thử mở `ASSIST`. Xác minh trên môi trường thử rằng `sos.monitoring-room-id` đúng, có đúng một nhân viên đủ điều kiện đang trực và Staff đăng nhập đúng người được phân công.
- Kiểm tra tiến trình media **đang chạy trên Pi** bằng log của nhóm. Pi phải giữ `GET /api/v1/pi/media-session/events`, xin Device join token của đúng session, vào LiveKit, phát camera + micro, nhận audio Staff ra loa và báo trạng thái qua `POST /api/v1/pi/media-sessions/{id}/state`. SSE chỉ mang sự kiện. Hai app có UI chưa chứng minh Pi có chương trình phát media.
- Nếu BE ghi nhận SOS nhưng danh sách phiên trống, kiểm tra trạng thái phân công, cấu hình media, kết nối SSE của Pi và session hiện tại của robot. Đừng nhập chữ `sos` vào Incident ID. Giá trị đúng là UUID do BE trả về.
- Source BE hiện có yêu cầu dừng các nhiệm vụ đang hoạt động khi vào `ASSIST`. Dùng robot và ca kiểm thử đã chuẩn bị khi chạy cuộc gọi thật.

Nguồn đối chiếu là [OpenAPI đang deploy](https://mediassistrover.duckdns.org/v3/api-docs), [trang test media](https://mediassistrover.duckdns.org/media-call.html) và [JavaScript của trang test](https://mediassistrover.duckdns.org/media-call.js). Kiểm tra lại hợp đồng lúc làm. Các nút trên trang test dùng để thao tác kỹ thuật, Staff app chỉ cần thực hiện chuỗi API đó phía sau một nút gọi.

## Checklist nghiệm thu

### UI app và Robot app · SOS

- [ ] Robot app qua `npm run check` và Staff app qua `npm run check:delivery`. Chạy thêm `node --test tests/robotPose.test.cjs` phía Staff để xác nhận phần sửa tọa độ vẫn qua.
- [ ] Bấm SOS một lần chỉ tạo một incident. Lỗi 401/mất mạng không hiện tiếp nhận giả. Thử lại sau mất phản hồi dùng cùng operation key.
- [ ] Cùng một Incident ID xuất hiện trong phản hồi Robot, thẻ Cảnh báo và phiên `ASSIST`. Nhân viên được phân công nhận được thẻ và vào được đúng phiên. Kiểm tra thêm tài khoản không được phân công.
- [ ] Hai sự cố đồng thời trên hai robot. Bấm thẻ A chỉ mở camera A. Thiếu session hoặc có lỗi quyền hiện lỗi rõ, không nhảy sang robot B.
- [ ] Một chạm mở màn hình gọi. Pi phát video và Staff thấy khung hình thay đổi. Staff nghe tiếng từ robot. Người đứng cạnh robot nghe rõ tiếng Staff. Chỉ ghi đạt hai chiều sau khi nghe thử từng chiều.
- [ ] Rút camera, tắt Pi media, từ chối quyền micro, mất mạng và phiên hết hạn. Mỗi trường hợp hiện đúng trạng thái, không hiện LIVE sai.
- [ ] Kết thúc rồi mở lại được phiên phù hợp. Micro và audio dừng sau khi thoát. QR giao nhận và nút hủy nhiệm vụ vẫn chạy.

### Robot app · Bản đồ dẫn đường

- [ ] Quét QR Expo Go của Robot app, chọn đúng phòng và bấm dẫn đường. Màn hình thực sự mở map chỉ dẫn khi nhận được chuyến đang chạy. Dùng UUID request/job do BE trả về để đối chiếu. Yêu cầu lỗi hiện lý do và cho thử lại.
- [ ] Dùng fixture tuyến `(0,0) → (1,0) → (1,-1.15)` trong hệ tọa độ map Y hướng lên. Ở pose `(0.57,0)` đang hướng theo trục X dương, banner hiện **“Còn 43 cm, rẽ phải”** và quãng đường còn lại **1,58 m**. Tuyến với Y dương ở đoạn cuối kiểm tra rẽ trái. Xoay map vẫn đọc đúng hướng.
- [ ] Khi robot đi tới, số đo thay đổi theo pose thật, dấu rẽ và đường còn lại cập nhật. ETA hiện khi có tốc độ, ẩn khi đứng yên hoặc mất định vị. Kiểm tra đổi plan, qua góc rẽ và có hai đường nằm gần nhau.
- [ ] Tọa độ `null`, plan rỗng, sai map, sai job, dữ liệu cũ và mất mạng hiển thị trạng thái chờ phù hợp. Không vẽ robot tại gốc map do ép kiểu `null`. Nút dừng dùng UUID của chuyến thực và kết quả từ BE.
- [ ] Trên tablet ngang, banner đọc được, tuyến đi và tường vẫn rõ, tên phòng không bị cắt và các nút dừng/SOS dễ chạm. Đối chiếu với ảnh mẫu.
- [ ] Trên Pi/robot thử nghiệm, chạy một tuyến đi thẳng, một rẽ trái và một rẽ phải. Đối chiếu chuyển động, đường Nav2, trạng thái đã đến và xử lý dừng. Phân biệt ảnh fixture với kết quả chạy thật.

Khi bàn giao, chia báo cáo theo **UI app U1**, **Robot app R1** và **Robot app R2**. Ghi file đã sửa, kết quả build/test và bước đã xác minh trên thiết bị. Nếu thiếu Pi, tài khoản trực hoặc nguồn guidance được cấp quyền, ghi đúng phần còn chờ nghiệm thu.
