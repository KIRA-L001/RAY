import { Module } from "@nestjs/common";
import { PaymentService } from "./payment.service";
import { PaymentsController } from "./payments.controller";
import { RAZORPAY_ADAPTER, RazorpayAdapter, razorpayConfigFromEnv } from "./razorpay.adapter";

@Module({
  controllers: [PaymentsController],
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
