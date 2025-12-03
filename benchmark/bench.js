"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tinybench_1 = require("tinybench");
const index_js_1 = require("../index.js");
function add(a) {
    return a + 100;
}
const b = new tinybench_1.Bench();
b.add('Native a + 100', () => {
    (0, index_js_1.plus100)(10);
});
b.add('JavaScript a + 100', () => {
    add(10);
});
await b.run();
console.table(b.table());
