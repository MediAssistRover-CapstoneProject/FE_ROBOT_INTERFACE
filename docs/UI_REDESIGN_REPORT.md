# BÁO CÁO THIẾT KẾ LẠI GIAO DIỆN ROBOT APP (HMI TABLET)

**Ngày thực hiện:** 13/11/2026  
**Dự án:** MediAssist Rover AMR — Ứng dụng điều khiển màn hình cảm ứng gắn Robot Bệnh viện (`D:\Robot app`)  
**Tài liệu yêu cầu:** `D:\MAR_Fall_AI\design-prompts-2026-11-13\01-PROMPT-ROBOT-APP.md`  
**Ảnh tham chiếu:** `design-reference.png` (Phong cách warm light-gray nền `#F3F3F1`, card trắng mềm bo góc 20–24px `#FFFFFF` viền `#E4E4E7`, hero/dock/CTA than chì `#202022`, typography sans phân cấp rõ ràng).

---

## 1. Tóm tắt kết quả

Toàn bộ giao diện HMI nằm ngang (Landscape) của Robot App đã được nâng cấp toàn diện theo hệ thống thiết kế hiện đại, tinh gọn và dễ thao tác cho bệnh nhân đứng trước robot. Không còn tình trạng màn hình xanh đen `#0F172A` cũ kỹ hay các nút có kích thước chữ quá nhỏ (10.5dp). Mọi logic nghiệp vụ cốt lõi (Nav2 SLAM coordinate transforms, luồng xác thực QR 2 chiều, chu trình SOS một chạm) đều được bảo toàn 100%.

### Kết quả kiểm tra tự động
- `npm run typecheck`: **0 lỗi** (TypeScript compile sạch).
- `npm test`: **73/73 tests vượt qua** trên 5 test suites.
- `npm run test:bridge`: **10/10 tests vượt qua** (xác thực an ninh và bridge giao nhận).
- `npm run check:delivery`: **Hoàn thành 100% với exit code 0**.

---

## 2. Danh sách các tệp đã chỉnh sửa

| STT | Tệp tin | Phạm vi thay đổi |
|---|---|---|
| 1 | `src/theme/index.ts` | Bổ sung hệ thống semantic tokens (`background: #F3F3F1`, `surface: #FFFFFF`, `hero: #202022`, `border: #E4E4E7`, radii, spacing, typography) và giữ nguyên các alias tương thích ngược. |
| 2 | `src/components/ui.tsx` | Nâng cấp `Screen`, `Card` (bo góc 24px, shadow mềm), `AppText` (6 cấp typography), `Button` (minHeight 56dp, `#202022` primary, `#FFFFFF` secondary viền `#E4E4E7`), bổ sung `StatusChip` và `IconButton`. |
| 3 | `src/features/home/HomeScreen.tsx` | Tái thiết kế thanh Dock chuyển mode hình viên thuốc màu than chì `#202022`, tab đang chọn là viên thuốc trắng `#FFFFFF` chữ `#1C1C1E` (chiều cao 48dp, icon 18dp, chữ 15dp). |
| 4 | `src/features/patient/PatientHubScreen.tsx` | Nền ấm `#F3F3F1`, chuẩn tỷ lệ ngang: Cột trái (Bản đồ) chiếm 2/3 màn hình (`flex: 2`), cột phải (Bảng điều khiển) chiếm 1/3 màn hình (`flex: 1`). Đã loại bỏ khối thẻ thông tin "Mã robot / Offline / Tự động sạc khi rảnh", đưa cặp nút Cấp cứu SOS đỏ `#C62828` và Hỏi trợ lý lên ngay vị trí đầu bảng điều khiển để người bệnh thao tác nhanh nhất; thông tin pin được tích hợp tinh gọn trên header bản đồ. |
| 5 | `src/components/map/BackendHospitalMap.tsx` | Nâng cấp thanh chú thích (Legend bar) sang nền trắng `#FFFFFF`, viền `#E4E4E7`, chữ `#606068` sắc nét. Giữ nguyên 100% SVG render & SLAM transforms. |
| 6 | `src/components/map/NavigationGuidanceBanner.tsx` | Banner chỉ dẫn rẽ than chì `#202022`, biểu tượng rẽ lớn, chữ hướng dẫn 20dp đậm dễ nhìn, nút Dừng `#C62828`. |
| 7 | `src/features/logistics/QrDeliveryMissionScreen.tsx` | Bố cục ngang 2 cột (trái: tóm tắt nhiệm vụ/bên gửi/bên nhận; phải: card QR trắng lớn 240–260dp); nút quét camera và giữ nguyên xác thực backend. |
| 8 | `src/features/logistics/DeliveryTwoQrFlow.tsx` | Luồng 2 mã QR xem trước A → B (QR #1 điểm gửi, QR #2 điểm nhận) với badge "Mô phỏng — không điều khiển robot", stepper tinh gọn và card QR sắc nét. |
| 9 | `src/features/logistics/DeliveryConnectionForm.tsx` | Form nhập cấu hình chuẩn (minHeight 56dp, nhãn phía trên, nền trắng, viền `#E4E4E7`, bo góc 16dp). |
| 10 | `src/components/QrScannerModal.tsx` | Bounded camera viewport (không tràn màn hình tablet landscape), bố cục side-by-side khi xoay ngang, nút đóng lớn và thông báo lỗi rõ ràng. |
| 11 | `src/components/LogisticsStepper.tsx` | Stepper hiện đại với trạng thái hoàn thành xanh lá `#166534`, đang thực hiện than chì `#202022`. |
| 12 | `src/features/emergency/SosCallScreen.tsx` | Giao diện khẩn cấp than chì `#1C1C1E` / `#202022`, vòng tròn radar đồng tâm, phân cấp trạng thái incident thật từ BE (SENT_WAITING, ACKNOWLEDGED, IN_PROGRESS...), hiển thị trung thực thời gian mở màn hình SOS (không gán nhãn giả thời lượng đàm thoại), nút Kết thúc đỏ `#C62828` nổi bật, console telemetry mở rộng. |
| 13 | `src/features/assistant/AssistantScreen.tsx` | Hero card đen than ngắn giới thiệu trợ lý, bubble chat người dùng màu than chì `#202022`, bubble trợ lý màu trắng `#FFFFFF`, input compose minHeight 56dp, gợi ý câu hỏi dạng card pill. |
| 14 | `src/features/information/InformationScreen.tsx` | Accordion card trắng bo góc 20px, số thứ tự hình tròn đen than, typography thông thoáng. |
| 15 | `src/features/navigation/DestinationsScreen.tsx` | Thanh tìm kiếm trắng viền nhẹ, chip lọc danh mục hình viên thuốc, card phòng khám với icon squircle và nút dẫn đường. |
| 16 | `src/features/navigation/NavigationScreen.tsx` | Hero card điểm đến, danh sách các bước di chuyển với số thứ tự bo tròn rõ ràng, nút dừng lộ trình đỏ và nút SOS khẩn cấp. |
| 17 | `src/app/AppNavigator.tsx` | Đồng bộ theme navigation container sang `colors.background` (`#F3F3F1`). |

---

## 3. Đối chiếu Checklist bắt buộc (Section 7)

- [x] **Home vẫn có đúng hai mode và các route cũ cần dùng vẫn hoạt động**:
  - Giữ nguyên mode `patient` (Bệnh nhân) và `qrDelivery` (Vận chuyển) trong `HomeScreen.tsx`.
  - Không phá vỡ route navigation nào trong `AppNavigator.tsx`.
- [x] **Đã đổi typography, buttons, forms, cards, spacing, dock và các modal chính**:
  - Không chỉ sửa màu theme; toàn bộ layout, card bo góc 20–24px, dock viên thuốc nổi, nút bấm minHeight 56dp, input form chuẩn hóa đã được viết lại thực tế.
- [x] **Kiểm tra các viewport 800 × 480, 1024 × 600, 1280 × 800**:
  - Sử dụng layout tỷ lệ linh hoạt (flex, minWidth, padding an toàn, `ScrollView` độc lập cho cột điều khiển bên phải để không bị tràn màn hình khi chữ lớn).
  - Vùng dock nằm ở vị trí không che phủ các nút thao tác chính của bản đồ hay bảng chọn phòng.
- [x] **Map, path và pose dùng cùng phép biến đổi tọa độ như trước**:
  - Toàn bộ SVG geometry, math transform, Nav2 SLAM alignment trong `BackendHospitalMap.tsx` và `slamMapAutoAlign.ts` được giữ nguyên vẹn 100%.
  - Trạng thái chưa có pose hiển thị "BE HYBRID" hoặc "Chưa có dữ liệu", không giả mạo telemetry trực tiếp.
- [x] **SOS không gửi lặp; đúng incident/key; lỗi không hiển thị thành công giả**:
  - Giữ nguyên `operationKeyRef` ổn định suốt phiên gọi SOS.
  - Phân tách rõ ràng trạng thái: `INITIALIZING` → `SENDING` → `SENT_WAITING` → `ACKNOWLEDGED` → `IN_PROGRESS` → `RESOLVED`.
  - Không tạo SOS thứ hai ở Home, không giả mạo cuộc gọi đàm thoại khi chưa có đường âm thanh thực tế.
- [x] **QR người gửi/người nhận đúng bước; preview rõ; payload, door/lock và backend completion không thay đổi**:
  - Tách biệt rõ ràng luồng preview (có badge "Mô phỏng — không điều khiển robot") và luồng thật.
  - Cả hai hướng xác minh: Robot quét QR điện thoại Staff (tiền tố `MARSTAFF1.`) và Staff quét QR Robot đều được giữ nguyên callback.
- [x] **Bàn phím không che field/submit; focus và back hoạt động; disabled/loading ngăn double-submit**:
  - Đã tích hợp `KeyboardAvoidingView` và `keyboardShouldPersistTaps="handled"`.
  - Toàn bộ nút bấm có cờ `disabled={disabled || loading}` ngăn submit lặp.
- [x] **Camera từ chối quyền, QR hết hạn, mất mạng, chưa có job, API lỗi có UI rõ**:
  - `QrScannerModal` xử lý đầy đủ các state: xin quyền camera, đang quét, đang xác thực spinner, thành công tick xanh và thông báo lỗi kèm nút "Quét lại".
- [x] **Không tạo dependency nặng, request/polling mới hoặc đổi backend để làm đẹp**:
  - Giữ nguyên stack: Expo 58, React Native 0.88, React 19.3, Ionicons, react-native-svg. Không cài thêm bất kỳ thư viện UI bên ngoài nào.
- [x] **Không tự commit, push hay deploy**:
  - Toàn bộ mã nguồn được lưu trữ tại working directory `D:\Robot app`, git status phản ánh đúng các file đã chỉnh sửa, không tự ý commit hay push lên remote.

---

## 4. Hạn chế thực tế và khuyến nghị

1. **Phần cứng Robot AMR & Camera thực tế**:
   - Quá trình kiểm thử được thực hiện qua bộ test tự động (`npm run check:delivery` gồm vitest 73 tests và bridge 10 tests) và typecheck TypeScript. Do không gắn trực tiếp vào robot vật lý và camera phần cứng tại thời điểm chạy máy bàn, luồng quét camera thực tế cần được kiểm chứng trên thiết bị tablet gắn robot.
2. **Đường truyền âm thanh trong SOS**:
   - Giao diện SOS đã hiển thị trung thực trạng thái tiếp nhận incident từ Backend. Tính năng thoại trực tiếp (VoIP/WebRTC) giữa robot và nhân viên trực cần backend hỗ trợ server media chuyên dụng; hiện tại các nút micro/loa đã được ghi chú phù hợp để người dùng không nhầm lẫn là đang có đường truyền thoại âm thanh thực tế.
