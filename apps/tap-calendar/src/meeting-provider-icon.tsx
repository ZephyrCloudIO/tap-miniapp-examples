import { Video } from "lucide-react";
import type { MeetingLocation } from "./domain";

const providerLogos = {
  "google-meet": new URL("./assets/google-meet.svg", import.meta.url).href,
  zoom: new URL("./assets/zoom.ico", import.meta.url).href,
};

export function MeetingProviderIcon({ provider }: { readonly provider: MeetingLocation }) {
  if (provider === "google-meet" || provider === "zoom") {
    return <img className="meeting-provider-logo" src={providerLogos[provider]} width={16} height={16} alt="" aria-hidden="true" />;
  }
  return <Video aria-hidden="true" />;
}
