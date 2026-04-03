import { DurableObject } from "cloudflare:workers";

export interface TrackLocator {
  location: "local";
  sessionId: string;
  trackName: string;
}

export class LiveStore extends DurableObject {
  async setTracks(tracks: TrackLocator[]): Promise<void> {
    await this.ctx.storage.put("tracks", tracks);
  }

  async getTracks(): Promise<TrackLocator[]> {
    return (await this.ctx.storage.get<TrackLocator[]>("tracks")) ?? [];
  }

  async deleteTracks(): Promise<void> {
    await this.ctx.storage.delete("tracks");
  }
}
