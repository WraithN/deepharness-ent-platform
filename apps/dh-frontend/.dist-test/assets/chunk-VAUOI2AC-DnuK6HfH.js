import { t as select_default } from "./src-4Uq4GVbL.js";
import { n as __name } from "./chunk-Y2CYZVJY-DUN_E3Zt.js";
import { x as getConfig2 } from "./chunk-WYO6CB5R-Cw7oSHEb.js";
var selectSvgElement = /* @__PURE__ */ __name((id) => {
	const { securityLevel } = getConfig2();
	let root = select_default("body");
	if (securityLevel === "sandbox") root = select_default((select_default(`#i${id}`).node()?.contentDocument ?? document).body);
	return root.select(`#${id}`);
}, "selectSvgElement");
export { selectSvgElement as t };
