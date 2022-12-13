const express = require("express");
const Joi = require("joi");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const gravatar = require("gravatar");
const path = require("path");
const fs = require("fs/promises");
const Jimp = require("jimp");

const User = require("../../models/users");

const { authorize, upload } = require("../../middlewares");

const { createError } = require("../../helpers");
const router = express.Router();

const userRegisterSchema = Joi.object({
  email: Joi.string()
    .pattern(/[a-z0-9]+@[a-z]+\.[a-z]{2,3}/)
    .required(),
  password: Joi.string().required(),
  subscription: Joi.string().required(),
});
const userLoginSchema = Joi.object({
  email: Joi.string()
    .pattern(/[a-z0-9]+@[a-z]+\.[a-z]{2,3}/)
    .required(),
  password: Joi.string().required(),
});
const subscriptionSchema = Joi.object({
  subscription: Joi.string().required(),
});

const { SECRET_KEY } = process.env;

router.post("/register", async (req, res, next) => {
  try {
    const { error } = userRegisterSchema.validate(req.body);
    if (error) {
      throw createError(400, error.message);
    }
    const { email, password, subscription } = req.body;
    const user = await User.findOne({ email });
    if (user) {
      throw createError(409, "Email in use");
    }
    const hashPassword = await bcrypt.hash(password, 10);
    const avatarURL = gravatar.url(email);
    const result = await User.create({
      email,
      password: hashPassword,
      subscription,
      avatarURL,
    });
    res.status(201).json({
      email: result.email,
      subscription: result.subscription,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { error } = userLoginSchema.validate(req.body);
    if (error) {
      throw createError(400, error.message);
    }
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    const passwordCompare = await bcrypt.compare(password, user.password);

    if (!user || !passwordCompare) {
      throw createError(401, "Email or password is wrong");
    }
    const payload = {
      id: user._id,
    };
    const token = jwt.sign(payload, SECRET_KEY, { expiresIn: "1h" });
    await User.findByIdAndUpdate(user._id, { token });
    res.json({
      token,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/logout", authorize, async (req, res, next) => {
  try {
    const { _id } = req.user;
    await User.findByIdAndUpdate(_id, { token: "" });
    res.status(204).json({
      message: "Logout success",
    });
  } catch (error) {
    next(error);
  }
});

router.get("/current", authorize, async (req, res, next) => {
  try {
    const { email, subscription, avatarURL } = req.user;
    res.json({
      email,
      subscription,
      avatarURL,
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/subscription", authorize, async (req, res, next) => {
  try {
    const { error } = subscriptionSchema.validate(req.body);
    if (error) {
      throw createError(400, error.message);
    }
    const { _id, email, subscription } = req.user;
    const result = await User.findByIdAndUpdate(_id, req.body, {
      new: true,
    });

    if (!result) {
      throw createError(404, "Not found");
    }
    res.json({
      email,
      subscription,
    });
  } catch (error) {
    next(error);
  }
});

const avatarDir = path.join(__dirname, "../../", "public", "avatars");

router.patch(
  "/avatars",
  authorize,
  upload.single("avatar"),
  async (req, res, next) => {
    try {
      const { _id } = req.user;
      const { path: tmpDir, originalname } = req.file;
      const [extention] = originalname.split(".").reverse();
      const newAvatarName = `${_id}.${extention}`;
      const uploadDir = path.join(avatarDir, newAvatarName);
      try {
        Jimp.read(tmpDir, (err, image) => {
          if (err) createError(400);
          image.resize(250, 250).quality(60).write(uploadDir);
        });
      } catch (error) {
        return next(createError(400, "Something went wrong!"));
      }

      await fs.rename(tmpDir, uploadDir);
      const avatarURL = path.join("avatars", newAvatarName);

      await User.findByIdAndUpdate(_id, { avatarURL });
      res.json({
        avatarURL,
      });
    } catch (error) {
      await fs.unlink(req.file.path);
      console.log(error.message);
      next(error);
    }
  }
);

module.exports = router;
