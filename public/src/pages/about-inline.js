// Moved out of an inline <script type="module"> so it is part of the page bundle (see scripts/build-web.mjs).
import { mountTelegramBotCard } from "../components/telegram-bot-card/telegram-bot-card.js";
mountTelegramBotCard(document.getElementById("aboutTelegramCardMount"), { variant: "showcase" });
