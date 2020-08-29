"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateRoute = void 0;
const State_1 = require("../../controller/State");
class StateRoute {
    static initRoutes(app) {
        app.get('/state/:section', (req, res) => {
            res.status(200).send(State_1.state.getState());
        });
    }
}
exports.StateRoute = StateRoute;
//# sourceMappingURL=State.js.map