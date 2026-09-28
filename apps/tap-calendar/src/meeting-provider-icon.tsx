import googleMeetLogo from "./assets/google-meet.svg";
import zoomLogo from "./assets/zoom.ico";
import { Video } from "lucide-react";
import type { MeetingLocation } from "./domain";

const providerLogos = {
  "google-meet": googleMeetLogo,
  zoom: zoomLogo,
};

export function MeetingProviderIcon({ provider }: { readonly provider: MeetingLocation }) {
  if (provider === "google-meet" || provider === "zoom") {
    return <img className="meeting-provider-logo" src={providerLogos[provider]} width={16} height={16} alt="" aria-hidden="true" />;
  }
  return <Video aria-hidden="true" />;
}
