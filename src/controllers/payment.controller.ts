import { Request, Response } from "express";
import { supabase } from "../config/supabase";

export const createPayment = async (
  req: Request,
  res: Response
) => {
  try {
    const {
      booking_id,
      amount,
      payment_method,
      payment_status,
      transaction_id,
    } = req.body;

    const { data, error } = await supabase
      .from("payments")
      .insert([
        {
          booking_id,
          amount,
          payment_method,
          payment_status,
          transaction_id,
        },
      ])
      .select();

    if (error) {
      return res.status(500).json(error);
    }

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};