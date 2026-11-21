import { App5Provider } from "./app5";
import { UpdateBar } from "./components/Desktop";
import { Guard, Host } from "./timeline/Host";

/**
 * The app: one page, the track view. The state (a song of tracks and clips, the ideas, the settings) is held by the
 * provider; the host builds the view from it, with the player, the plugin windows, the Canvas and the two sheets.
 */
export default function App() {
  return (
    <App5Provider>
      <div className="app5">
        <UpdateBar />
        <Guard what="the app">
          <Host />
        </Guard>
      </div>
    </App5Provider>
  );
}
