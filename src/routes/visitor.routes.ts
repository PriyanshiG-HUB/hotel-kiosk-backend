import { Router } from "express";
import { createVisitor,getVisitors ,checkoutVisitor,getVisitorById, searchVisitorByName} from "../controllers/visitor.controller";

const router = Router();

router.post("/", createVisitor);
router.get("/", getVisitors);
router.get(
  "/search/name/:name",
  searchVisitorByName
);

router.get(
  "/:visitorId",
  getVisitorById
);
router.post("/checkout", checkoutVisitor);
export default router;