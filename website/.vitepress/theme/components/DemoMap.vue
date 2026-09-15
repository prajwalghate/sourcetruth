<script setup lang="ts">
// The real map of a bundled example, beside a list of steps that drive it. Each step sets the
// map's link target (#e-Unit-action, #u-Unit, #a-party, #learn, #map); the map follows links
// while it is open, so the page never reloads it.
import { computed, ref } from "vue";
import { withBase } from "vitepress";

type Step = { anchor: string; title: string; detail: string };
type Example = { file: string; label: string; steps: Step[] };

const props = withDefaults(defineProps<{ set?: "solidity" | "daml"; tabs?: boolean; height?: number }>(), {
  set: "solidity",
  tabs: true,
  height: 640,
});

// Step text is written here, by hand, against what the examples actually produce; the examples
// are pinned by tests so these statements stay true.
const EXAMPLES: Record<"solidity" | "daml", Example> = {
  solidity: {
    file: "/demo/solidity-vault.html",
    label: "Solidity vault",
    steps: [
      { anchor: "map", title: "Find the blind spot", detail: "The amber <code>1 blind spot</code>, top right, is the one call it couldn’t follow. Everything else was traced." },
      { anchor: "a-anyone", title: "See who can act", detail: "<code>anyone</code> is outside the protocol: functions with no access check at all." },
      { anchor: "e-Vault-takeFee", title: "Open an unguarded function", detail: "<code>takeFee</code> has no check and moves tokens. Press <b>Play</b> in the map." },
      { anchor: "e-Vault-harvest", title: "Find a guard inside a helper", detail: "Only <code>keepers[msg.sender]</code> — checked in <code>_onlyKeeper()</code>, not a modifier." },
      { anchor: "e-Vault-execute", title: "Look at the blind spot", detail: "A <code>delegatecall</code> to an address the caller passes in. Read this one by hand." },
      { anchor: "u-Strategy", title: "Follow into the strategy", detail: "All four of its actions can be taken only by <code>vault</code>." },
      { anchor: "learn", title: "Learn the symbols", detail: "Each idea of the language, drawn with this example’s contracts." },
    ],
  },
  daml: {
    file: "/demo/daml-lending.html",
    label: "Daml lending",
    steps: [
      { anchor: "map", title: "Find the blind spot", detail: "The amber <code>1 blind spot</code>, top right: a fetch whose contract id it couldn’t type." },
      { anchor: "a-liquidator", title: "See who can act alone", detail: "<code>liquidator</code> is outside the protocol and needs no one’s consent." },
      { anchor: "e-Position-Liquidate", title: "Open the liquidation", detail: "The liquidator names itself, supplies <code>priceCid</code>, and carries <code>operator</code> and <code>owner</code> authority." },
      { anchor: "e-Pool-OpenPosition", title: "See a repeatable action", detail: "The pool stays; every call makes another <code>Position</code>." },
      { anchor: "u-Position", title: "Read a contract’s life", detail: "Made by <code>OpenPosition</code>, replaced by <code>Borrow</code> and <code>Repay</code>, ended by <code>Close</code> or <code>Liquidate</code>." },
      { anchor: "learn", title: "Learn the symbols", detail: "Borrowed authority and caller-chosen ids, drawn with this code." },
    ],
  },
};

const active = ref<"solidity" | "daml">(props.set);
const current = computed(() => EXAMPLES[active.value]);
const index = ref(0);
const frame = ref<HTMLIFrameElement | null>(null);
const src = ref(withBase(`${EXAMPLES[props.set].file}#map`));
const openHref = computed(() => withBase(`${current.value.file}#${current.value.steps[index.value].anchor}`));

function go(i: number) {
  index.value = i;
  const { file, steps } = current.value;
  const anchor = steps[i].anchor;
  try {
    const win = frame.value?.contentWindow;
    if (win && win.location.pathname.endsWith(file)) {
      win.location.hash = anchor;
      return;
    }
  } catch {
    /* not readable yet: fall through and navigate the frame */
  }
  src.value = withBase(`${file}#${anchor}`);
}

function pick(set: "solidity" | "daml") {
  if (set === active.value) return;
  active.value = set;
  index.value = 0;
  src.value = withBase(`${EXAMPLES[set].file}#map`);
}
</script>

<template>
  <div class="demo-map">
    <div v-if="tabs" class="tabs" role="tablist" aria-label="Example">
      <button
        v-for="(ex, key) in EXAMPLES"
        :key="key"
        role="tab"
        :aria-selected="active === key"
        @click="pick(key)"
      >{{ ex.label }}</button>
    </div>
    <div class="layout">
      <div class="side">
        <ol class="steps">
          <li v-for="(step, i) in current.steps" :key="step.anchor">
            <button :aria-current="i === index ? 'step' : undefined" @click="go(i)">
              <span class="n">{{ i + 1 }}</span>
              <span class="t">{{ step.title }}</span>
              <span class="d" v-html="step.detail"></span>
            </button>
          </li>
        </ol>
        <div class="nav">
          <button class="btn" :disabled="index === 0" @click="go(index - 1)">Back</button>
          <button class="btn primary" :disabled="index === current.steps.length - 1" @click="go(index + 1)">Next step</button>
        </div>
      </div>
      <div class="frame" :style="{ minHeight: `${height}px` }">
        <iframe ref="frame" :src="src" :title="`sourcetruth map of the ${current.label} example`" loading="lazy"></iframe>
      </div>
    </div>
    <p class="note">
      Generated with <code>sourcetruth --demo</code> from the examples in the repository.
      <a :href="openHref" target="_blank" rel="noopener">Open this map in its own tab</a>
    </p>
  </div>
</template>

<style scoped>
.demo-map { display: flex; flex-direction: column; gap: 14px; margin: 16px 0; }
.tabs { display: inline-flex; align-self: flex-start; gap: 2px; padding: 3px; border-radius: 10px; background: var(--vp-c-bg-soft); border: 1px solid var(--vp-c-divider); }
.tabs button { border: 0; background: none; padding: 7px 14px; border-radius: 7px; font-size: 14px; font-weight: 600; color: var(--vp-c-text-2); cursor: pointer; }
.tabs button[aria-selected="true"] { background: var(--vp-c-bg); color: var(--vp-c-text-1); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08); }
.layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; }
@media (max-width: 900px) { .layout { grid-template-columns: minmax(0, 1fr); } }
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.steps li { margin: 0; }
.steps button { width: 100%; display: grid; grid-template-columns: 24px 1fr; gap: 2px 10px; text-align: left; cursor: pointer;
  background: var(--vp-c-bg-soft); border: 1px solid transparent; border-radius: 10px; padding: 10px 12px; color: var(--vp-c-text-1); }
.steps button:hover { border-color: var(--vp-c-divider); }
.steps .n { grid-row: span 2; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 600;
  background: var(--vp-c-bg); color: var(--vp-c-text-2); border: 1px solid var(--vp-c-divider); }
.steps .t { font-size: 14px; font-weight: 600; line-height: 1.35; }
.steps .d { font-size: 13px; line-height: 1.45; color: var(--vp-c-text-2); }
.steps .d :deep(code) { font-size: 12px; padding: 1px 4px; }
.steps button[aria-current="step"] { background: var(--vp-c-brand-soft); border-color: var(--vp-c-brand-1); }
.steps button[aria-current="step"] .n { background: var(--vp-c-brand-1); border-color: var(--vp-c-brand-1); color: var(--vp-c-white); }
.nav { display: flex; gap: 8px; margin-top: 10px; }
.btn { font-size: 14px; font-weight: 600; padding: 7px 14px; border-radius: 20px; border: 1px solid var(--vp-c-divider); background: var(--vp-c-bg-soft); color: var(--vp-c-text-1); cursor: pointer; }
.btn.primary { background: var(--vp-button-brand-bg); border-color: var(--vp-button-brand-bg); color: var(--vp-button-brand-text); }
.btn:disabled { opacity: 0.45; cursor: default; }
.frame { position: relative; border: 1px solid var(--vp-c-divider); border-radius: 12px; overflow: hidden; background: var(--vp-c-bg); }
.frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.note { margin: 0; font-size: 13px; color: var(--vp-c-text-2); display: flex; flex-wrap: wrap; gap: 4px 12px; justify-content: space-between; }
</style>
