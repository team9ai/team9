export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  jti?: string;
  iat?: number;
  exp?: number;
}
