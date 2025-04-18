import express from "express";
import { deleteUser, listUser, loginUser, registerUser, updateUser } from "../controllers/userController.js";

const router = express.Router();

router.post("/register", registerUser);
router.get("/list", listUser);
router.put("/update/:id", updateUser);
router.delete("/delete/:id", deleteUser);

router.post("/login", loginUser);

export default router;
