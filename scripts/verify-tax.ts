import { calcCapitalGainsTax } from '../src/lib/tax/capital-gains';
import { calcBrokerFee, calcStampTax, calcTransactionCost } from '../src/lib/tax/transaction-costs';

const c = calcCapitalGainsTax({ salePrice: 1_500_000_000, acquisitionPrice: 800_000_000, expenses: 0, acquiredAt: '2019-08-01', soldAt: '2026-08-21', residenceMonths: 0, isOneHouseExempt: true, multiHouseSurcharge: false, isRegulated: false, usedBasicDeduction: 0 });
console.log('① 장특공률:', c.longTermRate, '% (기대 14)');
console.log('② 9억:', calcBrokerFee(900_000_000).rate, '(기대 0.5) / 12억:', calcBrokerFee(1_200_000_000).rate, '(기대 0.6) / 15억:', calcBrokerFee(1_500_000_000).rate, '(기대 0.7)');
console.log('④ 인지세 1억:', calcStampTax(100_000_000), '(기대 0) / 5억:', calcStampTax(500_000_000), '(기대 150000)');
const buy = calcTransactionCost({ price: 2_990_000_000, side: 'buy', withMortgage: true });
console.log('29.9억 매수부대:', buy.total.toLocaleString(), '/ 채권할인:', buy.bondDiscount.toLocaleString());
const c2 = calcCapitalGainsTax({ salePrice: 1_000_000_000, acquisitionPrice: 520_000_000, expenses: 25_000_000, acquiredAt: '2019-03-15', soldAt: '2026-08-21', residenceMonths: 89, isOneHouseExempt: true, multiHouseSurcharge: false, isRegulated: false, usedBasicDeduction: 0 });
console.log('사례 매도 양도세:', c2.total, '(기대 0) / exempt:', c2.exempt);
