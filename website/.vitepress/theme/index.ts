import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import DemoMap from "./components/DemoMap.vue";
import "./style.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("DemoMap", DemoMap);
  },
} satisfies Theme;
