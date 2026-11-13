# Tiến Độ Thiết Kế Lại Giao Diện Robot App (UI Redesign Progress)

Cập nhật: 13/11/2026

## 1. Mục tiêu
Thiết kế lại toàn bộ giao diện HMI Robot App (Landscape Tablet) theo phong cách hiện đại từ tài liệu tham chiếu `D:\MAR_Fall_AI\design-prompts-2026-11-13\01-PROMPT-ROBOT-APP.md` và `design-reference.png`:
- Nền ấm sáng: `#F3F3F1`
- Card trắng mềm: `#FFFFFF`, bo góc 20-24px, viền nhẹ 1px `#E4E4E7`
- Hero / Primary Action / Dock: Than chì đen `#202022`
- Chữ sans rõ phân cấp, tương phản cao, tối ưu cho bệnh nhân đứng trước màn hình cảm ứng robot
- Giữ 100% nghiệp vụ bệnh viện, định vị Nav2, QR giao nhận 2 chiều, SOS một chạm thật.

## 2. Trạng thái các giai đoạn

- [x] **R0 — Baseline**: Kiểm tra typecheck, vitest (73/73 tests pass), bridge test (10/10 pass), git status sạch.
- [x] **R1 — Foundation**:
  - `src/theme/index.ts`: Bổ sung toàn bộ design tokens (`background: #F3F3F1`, `surface: #FFFFFF`, `hero: #202022`, `border: #E4E4E7`, semantic colors, radii, spacing, typography presets) và giữ 100% semantic aliases tương thích ngược.
  - `src/components/ui.tsx`: Cập nhật `Screen` (nền `#F3F3F1`), `Card` (bo góc 24px, bóng đổ mềm), `AppText` (6 cấp typography), `Button` (minHeight 56dp, `#202022` primary, `#FFFFFF` secondary border `#E4E4E7`), bổ sung primitive `StatusChip` và `IconButton`.
- [x] **R2 — Màn hình bệnh nhân & Dẫn đường chuẩn**:
  - `src/features/home/HomeScreen.tsx`: Dock viên thuốc nổi màu than chì `#202022`, active tab là viên thuốc trắng `#FFFFFF` chữ `#1C1C1E` (chiều cao 48dp, icon 18dp, chữ 15dp).
  - `src/features/patient/PatientHubScreen.tsx`: Nền ấm `#F3F3F1`, header MediAssist Rover AMR với status chip Nav2 live / hybrid. Bản đồ đặt trong Card trắng lớn bo góc 24px. Bảng điều khiển gồm Card robot mini + pin, Card nút Cấp cứu SOS đỏ `#C62828` (minHeight 58dp) và Hỏi trợ lý (minHeight 56dp), Card điểm đến với CTA chính "Bắt đầu Dẫn đường" màu than chì `#202022`, Card chọn nhanh phòng với chips bo góc dễ chạm.
  - `src/components/map/BackendHospitalMap.tsx`: Chuyển legend bar sang nền trắng `#FFFFFF` và nhãn `#606068`.
  - `src/components/map/NavigationGuidanceBanner.tsx`: Tái thiết kế banner chỉ dẫn rẽ trên map màu than chì `#202022`, biểu tượng rẽ lớn, chữ hướng dẫn 20dp đậm tương phản cao, nút dừng `#C62828`.
- [x] **R3 — Vận chuyển và QR giao nhận**:
  - `src/features/logistics/QrDeliveryMissionScreen.tsx`: Bố cục ngang 2 cột (trái: tóm tắt nhiệm vụ/bước/bên gửi & nhận; phải: card QR trắng lớn kích thước 240–260dp); tích hợp quét camera nhân viên y tế và giữ nguyên xác thực backend.
  - `src/features/logistics/DeliveryTwoQrFlow.tsx`: Luồng 2 mã QR xem trước A → B (QR #1 điểm gửi, QR #2 điểm nhận) với badge "Mô phỏng — không điều khiển robot", stepper tinh gọn và card QR sắc nét.
  - `src/features/logistics/DeliveryConnectionForm.tsx`: Field nhập chuẩn (minHeight 56dp, nhãn phía trên, nền trắng, viền `#E4E4E7`, bo góc 16dp).
  - `src/components/QrScannerModal.tsx`: Giới hạn khung ngắm camera (bounded viewport không tràn màn hình tablet), bố cục side-by-side khi xoay ngang, nút đóng lớn và thông báo lỗi rõ ràng.
  - `src/components/LogisticsStepper.tsx`: Stepper hiện đại với trạng thái hoàn thành xanh lá `#166534`, đang thực hiện than chì `#202022`.
- [x] **R4 — SOS và các màn còn lại**:
  - `src/features/emergency/SosCallScreen.tsx`: Giao diện khẩn cấp than chì `#1C1C1E` / `#202022`, vòng tròn radar đồng tâm, phân cấp trạng thái incident thật từ BE (SENT_WAITING, ACKNOWLEDGED, IN_PROGRESS...), hiển thị trung thực thời gian mở màn hình SOS (không gán nhãn giả thời lượng đàm thoại), nút Kết thúc đỏ `#C62828` nổi bật, console telemetry mở rộng.
  - `src/features/assistant/AssistantScreen.tsx`: Hero card đen than ngắn giới thiệu trợ lý, bubble chat người dùng màu than chì `#202022`, bubble trợ lý màu trắng `#FFFFFF`, input compose minHeight 56dp, gợi ý câu hỏi dạng card pill.
  - `src/features/information/InformationScreen.tsx`: Accordion card trắng bo góc 20px, số thứ tự hình tròn đen than, typography thông thoáng.
  - `src/features/navigation/DestinationsScreen.tsx`: Thanh tìm kiếm trắng viền nhẹ, chip lọc danh mục hình viên thuốc, card phòng khám với icon squircle và nút dẫn đường.
  - `src/features/navigation/NavigationScreen.tsx`: Hero card điểm đến, danh sách các bước di chuyển với số thứ tự bo tròn rõ ràng, nút dừng lộ trình đỏ và nút SOS khẩn cấp.
  - `src/app/AppNavigator.tsx`: Đồng bộ theme navigation container sang `colors.background` (`#F3F3F1`).
- [x] **R5 — QA & Bàn giao**:
  - `npm run typecheck`: 0 lỗi.
  - `npm test`: 73/73 tests pass (100%).
  - `npm run test:bridge`: 10/10 tests pass (100%).
  - `npm run check:delivery`: 100% pass.
  - Tạo báo cáo hoàn thiện `docs/UI_REDESIGN_REPORT.md`.
