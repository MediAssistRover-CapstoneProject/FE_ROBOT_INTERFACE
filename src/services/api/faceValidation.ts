const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FACE_BASE64_LENGTH = 2_800_000;

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

/**
 * Chuẩn hóa chuỗi ảnh JPEG base64 theo hợp đồng FaceAuthService BE:
 * - Bóc prefix data:image/jpeg;base64, nếu có
 * - Kiểm tra magic header JPEG (/9j/ tương ứng 0xFF 0xD8 0xFF)
 * - Giới hạn kích thước tối đa 2,800,000 ký tự (~2MB binary)
 */
export function normalizeFaceJpegBase64(image: string): string {
  if (typeof image !== 'string') {
    throw new Error('FACE_INVALID_JPEG: Ảnh gửi xác thực phải là chuỗi JPEG base64.');
  }
  const stripped = image.trim().replace(/^data:image\/jpe?g;base64,/i, '').replace(/\s+/g, '');
  if (!stripped || stripped.length > MAX_FACE_BASE64_LENGTH || !stripped.startsWith('/9j/')) {
    throw new Error('FACE_INVALID_JPEG: Ảnh không đúng định dạng JPEG base64 (/9j/) hoặc vượt quá 2MB.');
  }
  return stripped;
}
