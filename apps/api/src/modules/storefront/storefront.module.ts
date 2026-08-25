import { Module } from "@nestjs/common";
import { StorefrontController } from "./storefront.controller";

@Module({
  controllers: [StorefrontController],
})
export class StorefrontModule {}
