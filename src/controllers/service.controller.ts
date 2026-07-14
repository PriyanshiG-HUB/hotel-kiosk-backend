import { Request, Response } from "express";
import { supabase } from "../config/supabase";

export const createServiceRequest = async (
  req: Request,
  res: Response
) => {
  try {
    const {
      room_number,
      guest_name,
      service_type,
      description,
    } = req.body;

    const { data, error } = await supabase
      .from("service_requests")
      .insert([
        {
          room_number,
          guest_name,
          service_type,
          description,
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

export const getServiceRequests = async (
  req: Request,
  res: Response
) => {
  try {
    const { data, error } = await supabase
      .from("service_requests")
      .select("*")
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      return res.status(500).json(error);
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const updateServiceStatus = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const { data, error } = await supabase
      .from("service_requests")
      .update({
        status,
      })
      .eq("request_id", id)
      .select();

    if (error) {
      return res.status(500).json(error);
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};