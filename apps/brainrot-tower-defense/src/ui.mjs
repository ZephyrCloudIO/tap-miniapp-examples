import "@theaiplatform/miniapp-sdk/ui/styles.css";
import backyard from "../assets/maps/backyard-wifi.webp";
import school from "../assets/maps/school-hallway-rush-v2.webp";
import foodCourt from "../assets/maps/food-court-frenzy.webp";
import suburb from "../assets/maps/suburban-doomscroll.webp";
import finalFeed from "../assets/maps/final-feed.webp";
import defenders from "../assets/sprites/tower-defenders.png";
import enemies from "../assets/sprites/brainrot-enemies-canonical.png";
import { configure_assets } from "./runtime.mjs";

configure_assets(backyard, school, foodCourt, suburb, finalFeed, defenders, enemies);

export * from "./runtime.mjs";
