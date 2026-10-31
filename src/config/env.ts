// Expo replaces statically referenced EXPO_PUBLIC_* values in the app bundle.
// These values are public. Never store passwords, API keys, or access tokens here.
declare const process: {
  env: {
    EXPO_PUBLIC_USE_MOCK?: string;
    EXPO_PUBLIC_ROBOT_API_URL?: string;
    EXPO_PUBLIC_ROBOT_ID?: string;
  };
};

export const env = Object.freeze({
  useMock: process.env.EXPO_PUBLIC_USE_MOCK !== 'false',
  robotApiUrl: process.env.EXPO_PUBLIC_ROBOT_API_URL?.trim() || 'http://localhost:8080',
  robotId: process.env.EXPO_PUBLIC_ROBOT_ID?.trim() || 'ROBOT_MAR_01',
});
