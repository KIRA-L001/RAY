import { Module } from "@nestjs/common";
import { PaymentService } from "./payment.service";
import { RAZORPAY_ADAPTER, RazorpayAdapter, razorpayConfigFromEnv } from "./razorpay.adapter";

@Module({
  providers: [
    PaymentService,
    {
      provide: RAZORPAY_ADAPTER,
      useFactory: () => new RazorpayAdapter(razorpayConfigFromEnv()),
    },
  ],
  exports: [PaymentService, RAZORPAY_ADAPTER],
})
export class PaymentsModule {}
