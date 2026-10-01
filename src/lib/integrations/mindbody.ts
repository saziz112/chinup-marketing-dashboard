/**
 * MindBody data shapes + phone normalization.
 * The live MindBody API client was removed with the MindBody cancellation
 * (2026-10-01). History lives in Postgres; see mindbody-db.ts / mindbody-sync.ts.
 */

// --- Types ---

export interface PurchasedItem {
    SaleDetailId: number;
    Id: number;
    IsService: boolean;
    BarcodeId: string;
    Description: string;
    CategoryId: number;
    SubCategoryId: number;
    UnitPrice: number;
    Quantity: number;
    DiscountPercent: number;
    DiscountAmount: number;
    TaxAmount: number;
    TotalAmount: number;
    Returned: boolean;
}

export interface Sale {
    Id: number;
    SaleDate: string;
    SaleTime: string;
    SaleDateTime: string;
    SalesRepId: number;
    ClientId: string;
    LocationId: number;
    PurchasedItems: PurchasedItem[];
    Payments: { Id: number; Amount: number; Type: string }[];
}

export interface Client {
    Id: string;
    FirstName: string;
    LastName: string;
    Email?: string;
    MobilePhone?: string;
    HomePhone?: string;
    ReferredBy?: string;
    ReferralSource?: string;
    FirstAppointmentDate?: string;
    CreationDate?: string;
}

export interface StaffAppointment {
    Id: number;
    StaffId: number;
    Staff: { Id: number; FirstName: string; LastName: string; DisplayName: string };
    StartDateTime: string;
    EndDateTime: string;
    Duration: number;
    Status: string;
    LocationId: number;
    SessionTypeId: number;
    SessionType?: { Id: number; Name: string };
    FirstAppointment: boolean;
    ClientId: string;
    Client?: { Id: string; FirstName: string; LastName: string };
    Notes?: string;
}

/** Normalize phone: strip non-digits, take last 10 digits */
export function normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : digits;
}
