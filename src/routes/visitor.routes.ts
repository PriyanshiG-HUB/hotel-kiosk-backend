import { Router } from "express";
import { createVisitor,getVisitors ,checkoutVisitor} from "../controllers/visitor.controller";

const router = Router();

router.post("/", createVisitor);
router.get("/", getVisitors);
router.post("/checkout", checkoutVisitor);
export default router;