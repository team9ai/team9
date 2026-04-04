import http from "../http";

export interface VapidPublicKeyResponse {
  publicKey: string;
}

export interface SubscribeResponse {
  id: string;
}

export interface UnsubscribeResponse {
  success: boolean;
}

/**
 * Get the VAPID public key from the server.
 * No auth required — needed before subscribing.
 */
export async function getVapidPublicKey(): Promise<VapidPublicKeyResponse> {
  const response = await http.get<VapidPublicKeyResponse>(
    "/v1/push-subscriptions/vapid-public-key",
  );
  return response.data;
}

/**
 * Subscribe to push notifications by sending the subscription to the server.
 */
export async function subscribe(
  subscription: PushSubscriptionJSON,
): Promise<SubscribeResponse> {
  const response = await http.post<SubscribeResponse>(
    "/v1/push-subscriptions",
    {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
    },
  );
  return response.data;
}

/**
 * Unsubscribe from push notifications by removing the subscription from the server.
 */
export async function unsubscribe(
  endpoint: string,
): Promise<UnsubscribeResponse> {
  const response = await http.delete<UnsubscribeResponse>(
    "/v1/push-subscriptions",
    {
      data: { endpoint },
    },
  );
  return response.data;
}
