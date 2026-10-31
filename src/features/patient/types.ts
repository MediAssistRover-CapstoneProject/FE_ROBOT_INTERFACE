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
    id: 'room-capcuu',
    roomCode: 'P_CAP_CUU',
    name: 'Phòng Cấp cứu',
    category: 'clinic',
    doctor: 'BS. Trực cấp cứu',
    location: 'Tầng 1 · Cấp cứu',
    eta: '~1 phút',
    distance: '~30m',
  },
  {
    id: 'room-102',
    roomCode: 'P_KHAM_NOI_01',
    name: 'Khám Nội tổng hợp',
    category: 'clinic',
    doctor: 'BS. Nguyễn Thị Lan',
    location: 'Tầng 1 · Phòng 102',
    eta: '~2 phút',
    distance: '~85m',
  },
  {
    id: 'room-105',
    roomCode: 'P_KHAM_NGOAI_02',
    name: 'Khám Ngoại khoa',
    category: 'clinic',
    doctor: 'BS. Trần Văn Hùng',
    location: 'Tầng 1 · Phòng 105',
    eta: '~3 phút',
    distance: '~120m',
  },
  {
    id: 'room-pharm',
    roomCode: 'P_NHA_THUOC',
    name: 'Nhà thuốc Bệnh viện',
    category: 'pharmacy',
    doctor: 'Dược sĩ trực',
    location: 'Tầng trệt · Quầy 1-4',
    eta: '~1.5 phút',
    distance: '~60m',
  },
  {
    id: 'room-201',
    roomCode: 'P_XET_NGHIEM',
    name: 'Xét nghiệm máu',
    category: 'lab',
    doctor: 'KTV. Hoàng Minh Tuấn',
    location: 'Tầng 2 · Khu B',
    eta: '~4 phút',
    distance: '~160m',
  },
  {
    id: 'room-service',
    roomCode: 'P_TIEP_DON',
    name: 'Ban Tiếp đón & BHYT',
    category: 'service',
    doctor: 'Quầy tiếp đón số 1',
    location: 'Sảnh chính',
    eta: '~1 phút',
    distance: '~40m',
  },
];

export const DEFAULT_MAP_ID = 'dee53b44-a8ef-446a-947e-c42aa14ce9c2';
