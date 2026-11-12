export type RootStackParamList = {
  Home: undefined;
  Destinations: { mode: 'directions' | 'escort' };
  Navigation: { taskId: string };
  Assistant: undefined;
  Information: undefined;
  Emergency:
    | {
        mapId?: string;
        xM?: number;
        yM?: number;
        roomCode?: string;
        roomName?: string;
        destinationName?: string;
      }
    | undefined;
  Logistics: undefined;
};

