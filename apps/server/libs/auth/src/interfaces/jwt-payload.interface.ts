export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  /**
   * Tenant scope of the request. Populated for bot-token auth from the
   * bot's installed application. Not present on standard user JWTs —
   * those rely on TenantMiddleware to resolve tenant from host/header.
   */
  tenantId?: string;
  jti?: string;
  iat?: number;
  exp?: number;
}
