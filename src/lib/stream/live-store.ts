import { DurableObject } from "cloudflare:workers";

export interface TrackLocator {
  location: "local";
  sessionId: string;
  trackName: string;
}

export class LiveStore extends DurableObject {
  private tracks: TrackLocator[] = [];

  async setTracks(tracks: TrackLocator[]): Promise<void> {
    this.tracks = tracks;
  }

  async getTracks(): Promise<TrackLocator[]> {
    return this.tracks;
  }

  async deleteTracks(): Promise<void> {
    this.tracks = [];
  }
}
