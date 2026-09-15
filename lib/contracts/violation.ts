import { z } from "zod";

export const ViolationSchema = z.object({
  rule: z.string(),
  message: z.string(),
});
export type Violation = z.infer<typeof ViolationSchema>;
