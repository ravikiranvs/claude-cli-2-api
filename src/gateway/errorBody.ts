export interface GatewayErrorBody {
  error: { message: string; type: string };
}

export function gatewayErrorBody(message: string, type: string): GatewayErrorBody {
  return { error: { message, type } };
}
