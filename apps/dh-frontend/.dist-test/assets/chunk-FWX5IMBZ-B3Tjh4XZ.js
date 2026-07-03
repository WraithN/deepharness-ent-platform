const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/dagre-VKFMJZFB-GFOdWDFM.js","assets/dist-RiTN_B_6.js","assets/index-DbiBhjOw.js","assets/index-BSjp-YFL.css","assets/chunk-HOUHSVGY-p1aXnL7N.js","assets/src-4Uq4GVbL.js","assets/chunk-Y2CYZVJY-DUN_E3Zt.js","assets/chunk-WYO6CB5R-Cw7oSHEb.js","assets/chunk-ICXQ74PX-BeFz-1-D.js","assets/dagre-CfZV_ZM9.js","assets/graphlib-B9uJ3iOz.js","assets/map-0D8aXo71.js","assets/chunk-RYQCIY6F-CavsumOO.js","assets/chunk-Q4XR5HBZ-C8uTWTnm.js","assets/chunk-52WLFC77-nlrj0fZC.js","assets/chunk-7BUUIJ7U-CdrSCwNa.js","assets/chunk-C7G6YPKG-DaYR2Xy0.js","assets/chunk-OGEWGWER-BSO1pmUi.js","assets/chunk-ZGVPDNZ5-BHXW69D5.js","assets/rough.esm-BAYOCqpo.js","assets/swimlanes-5IMT3BWC-DYFS_d1r.js","assets/cose-bilkent-JH36ORCC-DtoUTXXl.js","assets/cytoscape.esm-BeFs3Czg.js"])))=>i.map(i=>d[i]);
import { f as interpolateToCurve } from "./chunk-ICXQ74PX-BeFz-1-D.js";
import { n as log } from "./src-4Uq4GVbL.js";
import { dt as __vitePreload } from "./index-DbiBhjOw.js";
import { n as __name } from "./chunk-Y2CYZVJY-DUN_E3Zt.js";
import { b as getConfig, s as common_default } from "./chunk-WYO6CB5R-Cw7oSHEb.js";
import { a as insertNode, i as insertCluster, s as labelHelper } from "./chunk-ZGVPDNZ5-BHXW69D5.js";
import { a as markers_default, i as insertEdgeLabel, o as positionEdgeLabel, r as insertEdge } from "./chunk-52WLFC77-nlrj0fZC.js";
var internalHelpers = {
	common: common_default,
	getConfig,
	insertCluster,
	insertEdge,
	insertEdgeLabel,
	insertMarkers: markers_default,
	insertNode,
	interpolateToCurve,
	labelHelper,
	log,
	positionEdgeLabel
};
var layoutAlgorithms = {};
var registerLayoutLoaders = /* @__PURE__ */ __name((loaders) => {
	for (const loader of loaders) layoutAlgorithms[loader.name] = loader;
}, "registerLayoutLoaders");
(/* @__PURE__ */ __name(() => {
	registerLayoutLoaders([
		{
			name: "dagre",
			loader: /* @__PURE__ */ __name(async () => await __vitePreload(() => import("./dagre-VKFMJZFB-GFOdWDFM.js"), __vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19])), "loader")
		},
		{
			name: "swimlane",
			loader: /* @__PURE__ */ __name(async () => await __vitePreload(() => import("./swimlanes-5IMT3BWC-DYFS_d1r.js"), __vite__mapDeps([20,2,3,1,4,5,6,7,8,10,12,11,13,14,15,16,17,18,19])), "loader")
		},
		...[{
			name: "cose-bilkent",
			loader: /* @__PURE__ */ __name(async () => await __vitePreload(() => import("./cose-bilkent-JH36ORCC-DtoUTXXl.js"), __vite__mapDeps([21,2,3,22,5,6])), "loader")
		}]
	]);
}, "registerDefaultLayoutLoaders"))();
var render = /* @__PURE__ */ __name(async (data4Layout, svg, positions) => {
	if (!(data4Layout.layoutAlgorithm in layoutAlgorithms)) throw new Error(`Unknown layout algorithm: ${data4Layout.layoutAlgorithm}`);
	if (data4Layout.diagramId) for (const node of data4Layout.nodes) {
		const originalDomId = node.domId || node.id;
		node.domId = `${data4Layout.diagramId}-${originalDomId}`;
	}
	const layoutDefinition = layoutAlgorithms[data4Layout.layoutAlgorithm];
	const layoutRenderer = await layoutDefinition.loader();
	const { theme, themeVariables } = data4Layout.config;
	const { useGradient, gradientStart, gradientStop } = themeVariables;
	const svgId = svg.attr("id");
	svg.append("defs").append("filter").attr("id", `${svgId}-drop-shadow`).attr("height", "130%").attr("width", "130%").append("feDropShadow").attr("dx", "4").attr("dy", "4").attr("stdDeviation", 0).attr("flood-opacity", "0.06").attr("flood-color", `${theme?.includes("dark") ? "#FFFFFF" : "#000000"}`);
	svg.append("defs").append("filter").attr("id", `${svgId}-drop-shadow-small`).attr("height", "150%").attr("width", "150%").append("feDropShadow").attr("dx", "2").attr("dy", "2").attr("stdDeviation", 0).attr("flood-opacity", "0.06").attr("flood-color", `${theme?.includes("dark") ? "#FFFFFF" : "#000000"}`);
	if (useGradient) {
		const gradient = svg.append("linearGradient").attr("id", svg.attr("id") + "-gradient").attr("gradientUnits", "objectBoundingBox").attr("x1", "0%").attr("y1", "0%").attr("x2", "100%").attr("y2", "0%");
		gradient.append("svg:stop").attr("offset", "0%").attr("stop-color", gradientStart).attr("stop-opacity", 1);
		gradient.append("svg:stop").attr("offset", "100%").attr("stop-color", gradientStop).attr("stop-opacity", 1);
	}
	return layoutRenderer.render(data4Layout, svg, internalHelpers, { algorithm: layoutDefinition.algorithm }, positions);
}, "render");
var getRegisteredLayoutAlgorithm = /* @__PURE__ */ __name((algorithm = "", { fallback = "dagre" } = {}) => {
	if (algorithm in layoutAlgorithms) return algorithm;
	if (fallback in layoutAlgorithms) {
		log.warn(`Layout algorithm ${algorithm} is not registered. Using ${fallback} as fallback.`);
		return fallback;
	}
	throw new Error(`Both layout algorithms ${algorithm} and ${fallback} are not registered.`);
}, "getRegisteredLayoutAlgorithm");
export { registerLayoutLoaders as n, render as r, getRegisteredLayoutAlgorithm as t };
