import * as dotenv from 'dotenv';
import * as schedule from 'node-schedule';
import { DestinationNameAndJwt, WriteResponses, ErrorResponse} from '@sap/cloud-sdk-core';
import { Yy1_SalesDocCreditBlockApi as CreditBlockAPI } from "./external/lib/CreditBlockAPI";
import { batch as SOBatch, changeset as SOChangeset, SalesOrderItem } from "@sap/cloud-sdk-vdm-sales-order-service";
import { batch as SOWCBatch, changeset as SOWCChangeset, SalesOrderWithoutChargeItem } from "@sap/cloud-sdk-vdm-sales-order-without-charge-service";
import { setLogLevel, getLogger} from '@sap/cloud-sdk-util';

// I tried both signatures :)
setLogLevel("error", "proxy-util");
setLogLevel("error", getLogger("proxy-util"));
setLogLevel("error", "destination-accessor");
setLogLevel("error", getLogger("destination-accessor"));
setLogLevel("error", "environment-accessor");
setLogLevel("error", getLogger("environment-accessor"));

const FREQUENCY: number = process.env.JOB_FREQUENCY_MIN as unknown as number || 1;
const DEST_S4HCLOUD: DestinationNameAndJwt = {
    destinationName: 'S4HCLOUD'
};

async function getSalesDocumentItemsToModify(): Promise<CreditBlockAPI[]> {
    try {
        return CreditBlockAPI.requestBuilder().getAll().execute(DEST_S4HCLOUD);
    } catch (error) {
        console.log(error);
    }
}

async function updateOrders(OrderItems: CreditBlockAPI[]) {
    //group by sales order
    let groupedOrders: { [key: string]: CreditBlockAPI[] } = groupOrderItemsByOrder(OrderItems);
    
    sendRequests(groupedOrders);
}

async function sendRequests(orders: { [key: string]: CreditBlockAPI[] }) : Promise<void> {
    //create a batch request per order
    Object.keys(orders).forEach((order) => {
        if (orders[order].length > 0) {
            //split based on order type (standard order vs. free of charge) -> they have a different service
            //this is always the same for all items so we just look at the first one
            if (orders[order][0].sdDocumentCategory === 'C') {
                sendStandardOrderUpdateRequests(orders[order]);
            } else {
                sendFreeOfChargeOrderUpdateRequests(orders[order]);
            }
        } else {
            //no items for order so we skip this line, should never happen with current setup of the CDS
            return;
        }
    })
}

async function sendStandardOrderUpdateRequests(orderItems: CreditBlockAPI[]) {
    const requests = orderItems.map((orderItem) => {
        //still have to split here because the property names are different, *SIGH* SAP...
        const builder = SalesOrderItem.builder().salesOrder(orderItem.salesDocument).salesOrderItem(orderItem.salesDocumentItem);
        if (orderItem.setCreditBlock) {
            builder.salesDocumentRjcnReason("70");
        } else {
            builder.salesDocumentRjcnReason("");
        }

        return SalesOrderItem.requestBuilder().update(builder.build());
    });
    const errorMessage = `An error occured during the update of Sales Order ${orderItems[0].salesDocument}, see below more info`;

    try {
        const responses = await SOBatch(SOChangeset(...requests)).execute(DEST_S4HCLOUD) as any as WriteResponses[];
        responses.forEach((response) => {
            if (response.isSuccess()) {
                response.responses.forEach((response, index) => {
                    const isSuccesful = (response.httpCode >= 200 && response.httpCode < 300)
                    console.log(`${isSuccesful ? `Sales Order ${orderItems[0].salesDocument} Successfully updated` : errorMessage} `)
                    if (!isSuccesful) {
                        console.log((response as any).body.error.message.value)
                    }
                })
            } else {
                if(Array.isArray(response.responses)){
                    response.responses.forEach((response, index) => {
                        console.log(errorMessage)
                        console.log((response as any).body.error.message.value)
                    })
                }else{
                    console.log(errorMessage)
                    console.log((response as any).body.error.message.value)
                }
            }
        })
    } catch (error) {
        console.log(error);
    }
}

async function sendFreeOfChargeOrderUpdateRequests(orderItems: CreditBlockAPI[]) {
    const requests = orderItems.map((orderItem) => {
        //still have to split here because the property names are different, *SIGH* SAP...
        const builder = SalesOrderWithoutChargeItem.builder().salesOrderWithoutCharge(orderItem.salesDocument).salesOrderWithoutChargeItem(orderItem.salesDocumentItem);
        if (orderItem.setCreditBlock) {
            builder.salesDocumentRjcnReason("70");
        } else {
            builder.salesDocumentRjcnReason("");
        }

        return SalesOrderWithoutChargeItem.requestBuilder().update(builder.build());
    });
    const errorMessage = `An error occured during the update of Sales Order ${orderItems[0].salesDocument}, see below more info`;

    try {
        const responses = await SOWCBatch(SOWCChangeset(...requests)).execute(DEST_S4HCLOUD) as any as WriteResponses[];
        responses.forEach((response) => {
            if (response.isSuccess()) {
                response.responses.forEach((response, index) => {
                    const isSuccesful = (response.httpCode >= 200 && response.httpCode < 300)
                    console.log(`${isSuccesful ? `Sales Order ${orderItems[0].salesDocument} Successfully updated` : errorMessage} `)
                    if (!isSuccesful) {
                        console.log((response as any).body.error.message.value)
                    }
                })
            } else {
                if(Array.isArray(response.responses)){
                    response.responses.forEach((response, index) => {
                        console.log(errorMessage)
                        console.log((response as any).body.error.message.value)
                    })
                }else{
                    console.log(errorMessage)
                    console.log((response as any).body.error.message.value)
                }
            }
        })
    } catch (error) {
        console.log(error);
    }
}

function groupOrderItemsByOrder(orderItems: CreditBlockAPI[]) : { [key: string]: CreditBlockAPI[] } {
    orderItems = orderItems || [];

    let groupedOrders = orderItems.reduce<{ [key: string]: CreditBlockAPI[] }>(
        (resultObject, orderItem) => {
            resultObject[orderItem.salesDocument] = resultObject[orderItem.salesDocument] || [];
            resultObject[orderItem.salesDocument].push(orderItem);
            return resultObject;
    }, {});

    return groupedOrders;
}

async function main() {
    try {
        let salesDocumentItemsToModify = await getSalesDocumentItemsToModify();
        if (!Array.isArray(salesDocumentItemsToModify) || salesDocumentItemsToModify.length == 0) {
            console.log(":: Nothing to update ::");
        } else {
            updateOrders(salesDocumentItemsToModify);
        }
    } catch (error) {
        console.log(':: Error executing service :: ')
        console.error(error)
    }
}

main()
const cronRule = `*/${FREQUENCY} * * * *`
console.log(`Schedule: ${cronRule}`)
schedule.scheduleJob('salesreasonforrejection', cronRule, main)