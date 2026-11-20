export function checklistClient(client) {
  return `
    export const configured=true, ready=Promise.resolve(), initializationError=null, authLink={};
    export const auth={getSession:async()=>({data:{session:{user:{id:'staff'}}}}),onAuthStateChange:()=>{}};
    export const api=(action,payload={})=>window.fixtureApi(action,payload);
    export async function websiteVisitorStats(){return {};}
    export function calendarConnection(){} export function newsletterRequest(){} export function upload(){}
    export function affiliateReceipt(){} export function affiliatePayout(){} export function signedProofUrl(){}
    ${client.slice(client.indexOf('export function money('))}
  `;
}
