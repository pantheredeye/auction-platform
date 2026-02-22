import { DurableObject } from "cloudflare:workers";

export class AuctionRoomDO extends DurableObject {
  async fetch(_request: Request): Promise<Response> {
    return new Response("AuctionRoomDO placeholder", { status: 200 });
  }
}
