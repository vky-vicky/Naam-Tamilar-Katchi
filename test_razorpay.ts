import { RazorpayService } from './src/services/razorpay.service.js';

async function test() {
  console.log('Testing Razorpay Order Creation...');
  console.log('Key ID:', process.env.RAZORPAY_KEY_ID);
  
  const result = await RazorpayService.createOrder(1, 500);
  console.log('Result:', result);
}

test().catch(console.error);
