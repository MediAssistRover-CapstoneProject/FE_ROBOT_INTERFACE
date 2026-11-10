export interface ClinicDestination {
  id: string;
  roomCode: string;
  name: string;
  category: 'clinic' | 'lab' | 'pharmacy' | 'service';
  doctor: string;
  location: string;
  eta: string;
  distance: string;
}

export const DEFAULT_HOSPITAL_ROOMS: ClinicDestination[] = [
  {
    id: 'room-01',
    roomCode: '01',
    name: 'Phòng 1 (Cấp cứu)',
    category: 'clinic',
    doctor: 'BS. Trực cấp cứu',
    location: 'Tầng 1 · Cấp cứu',
    eta: '~1 phút',
    distance: '~20m',
  },
  {
    id: 'room-02',
    roomCode: '02',
    name: 'Phòng 2 (Khám Nội)',
    category: 'clinic',
    doctor: 'BS. Nguyễn Thị Lan',
    location: 'Tầng 1 · Phòng 102',
    eta: '~1.5 phút',
    distance: '~30m',
  },
  {
    id: 'room-03',
    roomCode: '03',
    name: 'Phòng 3 (Khám Ngoại)',
    category: 'clinic',
    doctor: 'BS. Trần Văn Hùng',
    location: 'Tầng 1 · Phòng 103',
    eta: '~2 phút',
    distance: '~45m',
  },
  {
    id: 'room-04',
    roomCode: '04',
    name: 'Phòng 4 (Cận lâm sàng)',
    category: 'lab',
    doctor: 'BS. Lê Hải Nam',
    location: 'Tầng 1 · Khu Kỹ thuật',
    eta: '~2.5 phút',
    distance: '~55m',
  },
  {
    id: 'room-05',
    roomCode: '05',
    name: 'Phòng 5 (Khoa Dược)',
    category: 'pharmacy',
    doctor: 'Dược sĩ trực',
    location: 'Tầng 1 · Khoa Dược',
    eta: '~2.5 phút',
    distance: '~50m',
  },
  {
    id: 'room-06',
    roomCode: '06',
    name: 'Phòng 6 (Xét nghiệm)',
    category: 'lab',
    doctor: 'KTV. Hoàng Minh Tuấn',
    location: 'Tầng 1 · Phòng 106',
    eta: '~3 phút',
    distance: '~65m',
  },
  {
    id: 'room-08',
    roomCode: 'c',
    name: 'Phòng 08 (Sảnh C)',
    category: 'service',
    doctor: 'Điều dưỡng trực',
    location: 'Khu trung tâm Tầng 1',
    eta: '~1.5 phút',
    distance: '~25m',
  },
  {
    id: 'room-09',
    roomCode: 'h',
    name: 'Phòng 09 (Hành lang H)',
    category: 'service',
    doctor: 'Điều dưỡng hướng dẫn',
    location: 'Khu trung tâm Tầng 1',
    eta: '~1.5 phút',
    distance: '~28m',
  },
  {
    id: 'room-lt',
    roomCode: 'lt',
    name: 'Quầy Lễ tân & Tiếp đón',
    category: 'service',
    doctor: 'Nhân viên trực tiếp đón',
    location: 'Sảnh chính Tầng 1',
    eta: '~1 phút',
    distance: '~15m',
  },
  {
    id: 'room-kho',
    roomCode: 'kho',
    name: 'Phòng Kho thiết bị',
    category: 'service',
    doctor: 'Bộ phận quản lý kho',
    location: 'Cánh Bắc Tầng 1',
    eta: '~3 phút',
    distance: '~70m',
  },
  {
    id: 'room-wc',
    roomCode: 'WC',
    name: 'Khu vệ sinh (WC)',
    category: 'service',
    doctor: 'Khu công cộng',
    location: 'Cánh Tây Tầng 1',
    eta: '~1.5 phút',
    distance: '~35m',
  },
];

export const DEFAULT_MAP_ID = 'e571fe71-d3ea-4aa5-a673-ffd857ac9f09';
