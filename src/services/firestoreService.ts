import { 
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy 
} from 'firebase/firestore';
import { db } from '../firebase';
import { Invoice, Party, Vehicle, Expense, CompanySettings, LedgerEntry, PaymentRecord, NoteReminder, AppUserAccount, ProductItem, StockTransaction } from '../types';
import { 
  initialCompanySettings, initialParties, initialVehicles, initialInvoices, initialExpenses, initialNotesReminders, initialAppUsers 
} from '../data/mockInitialData';

// Firestore collection names
const INVOICES_COL = 'invoices';
const PARTIES_COL = 'parties';
const VEHICLES_COL = 'vehicles';
const EXPENSES_COL = 'expenses';
const NOTES_REMINDERS_COL = 'notes_reminders';
const USERS_COL = 'app_users';
const PRODUCTS_COL = 'products';
const STOCK_TX_COL = 'stock_transactions';
const SETTINGS_DOC = 'settings/company_profile';

/**
 * Recursively removes keys with `undefined` values, NaN/Infinity, functions,
 * and formats all values safely so Firestore `setDoc` / `updateDoc` never throws errors.
 */
export function cleanForFirestore<T>(data: T, seen = new WeakSet()): T {
  if (data === null || data === undefined) {
    return null as unknown as T;
  }
  if (typeof data === 'number') {
    if (isNaN(data) || !isFinite(data)) {
      return 0 as unknown as T;
    }
    return data;
  }
  if (typeof data === 'string' || typeof data === 'boolean') {
    return data;
  }
  if (typeof data !== 'object') {
    return data;
  }
  if (data instanceof Date) {
    return data.toISOString() as unknown as T;
  }
  if (seen.has(data as object)) {
    return null as unknown as T;
  }
  seen.add(data as object);

  if (Array.isArray(data)) {
    return data
      .map(item => cleanForFirestore(item, seen))
      .filter(item => item !== undefined) as unknown as T;
  }

  const cleaned: Record<string, any> = {};
  for (const key of Object.keys(data as Record<string, any>)) {
    const val = (data as Record<string, any>)[key];
    if (val !== undefined && typeof val !== 'function' && typeof val !== 'symbol') {
      // Firestore fields cannot contain dots '.'
      const safeKey = key.replace(/\./g, '_');
      cleaned[safeKey] = cleanForFirestore(val, seen);
    }
  }
  return cleaned as T;
}

/**
 * Sanitizes and guarantees a non-empty string ID safe for Firestore document paths.
 */
export function sanitizeDocId(rawId: any, fallbackPrefix = 'doc'): string {
  if (rawId !== null && rawId !== undefined) {
    const str = String(rawId).trim().replace(/[/]/g, '_');
    if (str.length > 0) {
      return str;
    }
  }
  return `${fallbackPrefix}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

// Helper to clear old demo data and initialize clean company settings in Firestore
export async function seedInitialFirestoreData() {
  try {
    const SEED_KEY = 'nirmala_firestore_seed_v2';
    if (localStorage.getItem(SEED_KEY)) {
      return;
    }

    // Clear legacy demo IDs in parallel if present
    const legacyInvIds = ['inv-1001', 'inv-1002', 'inv-1003'];
    const legacyPtyIds = ['pty-1', 'pty-2', 'pty-3', 'pty-4'];
    const legacyVehIds = ['veh-1', 'veh-2', 'veh-3'];
    const legacyExpIds = ['exp-101', 'exp-102', 'exp-103', 'exp-104'];

    const deletePromises = [
      ...legacyInvIds.map(id => deleteDoc(doc(db, INVOICES_COL, id)).catch(() => {})),
      ...legacyPtyIds.map(id => deleteDoc(doc(db, PARTIES_COL, id)).catch(() => {})),
      ...legacyVehIds.map(id => deleteDoc(doc(db, VEHICLES_COL, id)).catch(() => {})),
      ...legacyExpIds.map(id => deleteDoc(doc(db, EXPENSES_COL, id)).catch(() => {}))
    ];

    await Promise.allSettled(deletePromises);

    const settingsSnap = await getDoc(doc(db, 'settings', 'company_profile'));
    if (!settingsSnap.exists()) {
      await setDoc(doc(db, 'settings', 'company_profile'), cleanForFirestore(initialCompanySettings));
    }

    localStorage.setItem(SEED_KEY, 'true');
    console.log('Firestore initialization complete');
  } catch (error) {
    console.warn('Firestore initialization note:', error);
  }
}

// Invoices CRUD
export function subscribeInvoices(callback: (invoices: Invoice[]) => void) {
  try {
    const q = query(collection(db, INVOICES_COL));
    return onSnapshot(q, (snapshot) => {
      const invoices: Invoice[] = [];
      snapshot.forEach((doc) => {
        invoices.push(doc.data() as Invoice);
      });
      // Sort newest first
      invoices.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      callback(invoices);
    }, (err) => {
      console.warn('Invoices subscription error, fallback to mock data', err);
      callback(initialInvoices);
    });
  } catch (err) {
    console.warn('Firestore query error', err);
    callback(initialInvoices);
    return () => {};
  }
}

export async function saveInvoice(invoice: Invoice): Promise<void> {
  try {
    const cleaned = cleanForFirestore(invoice);
    await setDoc(doc(db, INVOICES_COL, invoice.id), cleaned, { merge: true });
  } catch (error) {
    console.error('Error saving invoice:', error);
  }
}

export async function deleteInvoice(invoiceId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, INVOICES_COL, invoiceId));
  } catch (error) {
    console.error('Error deleting invoice:', error);
  }
}

// Record Payment against Invoice
export async function addInvoicePayment(
  invoice: Invoice, 
  payment: PaymentRecord
): Promise<void> {
  const updatedPayments = [...invoice.payments, payment];
  const newAmountPaid = updatedPayments.reduce((sum, p) => sum + p.amount, 0);
  const totalPaymentKasar = updatedPayments.reduce((sum, p) => sum + (p.kasarAmount || 0), 0);
  const newBalanceDue = Math.max(0, invoice.netPayable - (newAmountPaid + totalPaymentKasar));
  
  let newStatus: Invoice['paymentStatus'] = 'unpaid';
  if (newBalanceDue === 0) {
    newStatus = 'paid';
  } else if ((newAmountPaid + totalPaymentKasar) > 0) {
    newStatus = 'partial';
  }

  const updatedInvoice: Invoice = {
    ...invoice,
    payments: updatedPayments,
    amountPaid: newAmountPaid,
    balanceDue: newBalanceDue,
    paymentStatus: newStatus,
    updatedAt: new Date().toISOString()
  };

  await saveInvoice(updatedInvoice);
}

export async function updateInvoicePayment(
  invoice: Invoice,
  updatedPayment: PaymentRecord
): Promise<void> {
  const updatedPayments = invoice.payments.map(p => p.id === updatedPayment.id ? updatedPayment : p);
  const newAmountPaid = updatedPayments.reduce((sum, p) => sum + p.amount, 0);
  const totalPaymentKasar = updatedPayments.reduce((sum, p) => sum + (p.kasarAmount || 0), 0);
  const newBalanceDue = Math.max(0, invoice.netPayable - (newAmountPaid + totalPaymentKasar));

  let newStatus: Invoice['paymentStatus'] = 'unpaid';
  if (newBalanceDue === 0) {
    newStatus = 'paid';
  } else if ((newAmountPaid + totalPaymentKasar) > 0) {
    newStatus = 'partial';
  }

  const updatedInvoice: Invoice = {
    ...invoice,
    payments: updatedPayments,
    amountPaid: newAmountPaid,
    balanceDue: newBalanceDue,
    paymentStatus: newStatus,
    updatedAt: new Date().toISOString()
  };

  await saveInvoice(updatedInvoice);
}

export async function deleteInvoicePayment(
  invoice: Invoice,
  paymentId: string
): Promise<void> {
  const updatedPayments = invoice.payments.filter(p => p.id !== paymentId);
  const newAmountPaid = updatedPayments.reduce((sum, p) => sum + p.amount, 0);
  const totalPaymentKasar = updatedPayments.reduce((sum, p) => sum + (p.kasarAmount || 0), 0);
  const newBalanceDue = Math.max(0, invoice.netPayable - (newAmountPaid + totalPaymentKasar));

  let newStatus: Invoice['paymentStatus'] = 'unpaid';
  if (newBalanceDue === 0 && (newAmountPaid + totalPaymentKasar) > 0) {
    newStatus = 'paid';
  } else if ((newAmountPaid + totalPaymentKasar) > 0) {
    newStatus = 'partial';
  }

  const updatedInvoice: Invoice = {
    ...invoice,
    payments: updatedPayments,
    amountPaid: newAmountPaid,
    balanceDue: newBalanceDue,
    paymentStatus: newStatus,
    updatedAt: new Date().toISOString()
  };

  await saveInvoice(updatedInvoice);
}

// Parties CRUD
export function subscribeParties(callback: (parties: Party[]) => void) {
  try {
    const q = query(collection(db, PARTIES_COL));
    return onSnapshot(q, (snapshot) => {
      const parties: Party[] = [];
      snapshot.forEach((doc) => {
        parties.push(doc.data() as Party);
      });
      callback(parties);
    }, (err) => {
      console.warn('Parties subscription error', err);
      callback(initialParties);
    });
  } catch {
    callback(initialParties);
    return () => {};
  }
}

export async function saveParty(party: Party): Promise<void> {
  try {
    const cleaned = cleanForFirestore(party);
    await setDoc(doc(db, PARTIES_COL, party.id), cleaned, { merge: true });
  } catch (error) {
    console.error('Error saving party:', error);
  }
}

export async function deleteParty(partyId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, PARTIES_COL, partyId));
  } catch (error) {
    console.error('Error deleting party:', error);
  }
}

// Vehicles CRUD
export function subscribeVehicles(callback: (vehicles: Vehicle[]) => void) {
  try {
    const q = query(collection(db, VEHICLES_COL));
    return onSnapshot(q, (snapshot) => {
      const vehicles: Vehicle[] = [];
      snapshot.forEach((doc) => {
        vehicles.push(doc.data() as Vehicle);
      });
      callback(vehicles);
    }, (err) => {
      console.warn('Vehicles subscription error', err);
      callback(initialVehicles);
    });
  } catch {
    callback(initialVehicles);
    return () => {};
  }
}

export async function saveVehicle(vehicle: Vehicle): Promise<void> {
  try {
    const cleaned = cleanForFirestore(vehicle);
    await setDoc(doc(db, VEHICLES_COL, vehicle.id), cleaned, { merge: true });
  } catch (error) {
    console.error('Error saving vehicle:', error);
  }
}

export async function deleteVehicle(vehicleId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, VEHICLES_COL, vehicleId));
  } catch (error) {
    console.error('Error deleting vehicle:', error);
  }
}

// Expenses CRUD
export function subscribeExpenses(callback: (expenses: Expense[]) => void) {
  try {
    const q = query(collection(db, EXPENSES_COL));
    return onSnapshot(q, (snapshot) => {
      const expenses: Expense[] = [];
      snapshot.forEach((doc) => {
        expenses.push(doc.data() as Expense);
      });
      expenses.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      callback(expenses);
    }, (err) => {
      console.warn('Expenses subscription error', err);
      callback(initialExpenses);
    });
  } catch {
    callback(initialExpenses);
    return () => {};
  }
}

export async function saveExpense(expense: Expense): Promise<void> {
  try {
    const cleaned = cleanForFirestore(expense);
    await setDoc(doc(db, EXPENSES_COL, expense.id), cleaned, { merge: true });
  } catch (error) {
    console.error('Error saving expense:', error);
  }
}

export async function deleteExpense(expenseId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, EXPENSES_COL, expenseId));
  } catch (error) {
    console.error('Error deleting expense:', error);
  }
}

// Notes & Reminders CRUD
export function subscribeNotesReminders(callback: (notes: NoteReminder[]) => void) {
  try {
    const q = query(collection(db, NOTES_REMINDERS_COL));
    return onSnapshot(q, (snapshot) => {
      const notes: NoteReminder[] = [];
      snapshot.forEach((doc) => {
        notes.push(doc.data() as NoteReminder);
      });
      notes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      callback(notes);
    }, (err) => {
      console.warn('NotesReminders subscription error', err);
      callback(initialNotesReminders);
    });
  } catch {
    callback(initialNotesReminders);
    return () => {};
  }
}

export async function saveNoteReminder(note: NoteReminder): Promise<void> {
  try {
    const cleaned = cleanForFirestore(note);
    await setDoc(doc(db, NOTES_REMINDERS_COL, note.id), cleaned, { merge: true });
  } catch (error) {
    console.error('Error saving note/reminder:', error);
  }
}

export async function deleteNoteReminder(noteId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, NOTES_REMINDERS_COL, noteId));
  } catch (error) {
    console.error('Error deleting note/reminder:', error);
  }
}

// Products CRUD
export function subscribeProducts(callback: (products: ProductItem[]) => void) {
  try {
    const q = query(collection(db, PRODUCTS_COL));
    return onSnapshot(q, (snapshot) => {
      const products: ProductItem[] = [];
      snapshot.forEach((doc) => {
        products.push(doc.data() as ProductItem);
      });
      products.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      callback(products);
    }, (err) => {
      console.warn('Products subscription error', err);
      callback([]);
    });
  } catch {
    callback([]);
    return () => {};
  }
}

export async function saveProduct(product: ProductItem): Promise<void> {
  try {
    const cleaned = cleanForFirestore(product);
    await setDoc(doc(db, PRODUCTS_COL, product.id), cleaned, { merge: true });
  } catch (error) {
    console.error('Error saving product:', error);
  }
}

export async function deleteProduct(productId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, PRODUCTS_COL, productId));
  } catch (error) {
    console.error('Error deleting product:', error);
  }
}

// Adjust product stock & record transaction
export async function adjustProductStock(
  productId: string,
  deltaQty: number,
  transactionInfo: {
    productName: string;
    type: 'in' | 'out' | 'adjustment' | 'sales_bill' | 'purchase_bill';
    unit: string;
    rate?: number;
    referenceNo?: string;
    partyName?: string;
    date: string;
    notes?: string;
  }
): Promise<void> {
  try {
    const prodDocRef = doc(db, PRODUCTS_COL, productId);
    const prodSnap = await getDoc(prodDocRef);
    if (prodSnap.exists()) {
      const current = prodSnap.data() as ProductItem;
      const newStock = Math.max(0, (current.currentStock || 0) + deltaQty);
      await updateDoc(prodDocRef, {
        currentStock: newStock,
        updatedAt: new Date().toISOString()
      });
    }

    // Save stock transaction record
    const txId = `stk-tx-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const tx: StockTransaction = {
      id: txId,
      productId,
      productName: transactionInfo.productName,
      type: transactionInfo.type,
      quantity: Math.abs(deltaQty),
      unit: transactionInfo.unit,
      rate: transactionInfo.rate,
      referenceNo: transactionInfo.referenceNo,
      partyName: transactionInfo.partyName,
      date: transactionInfo.date || new Date().toISOString().split('T')[0],
      notes: transactionInfo.notes,
      createdAt: new Date().toISOString()
    };
    await setDoc(doc(db, STOCK_TX_COL, txId), cleanForFirestore(tx));
  } catch (error) {
    console.error('Error adjusting product stock:', error);
  }
}

// Stock Transactions CRUD
export function subscribeStockTransactions(callback: (txs: StockTransaction[]) => void) {
  try {
    const q = query(collection(db, STOCK_TX_COL));
    return onSnapshot(q, (snapshot) => {
      const txs: StockTransaction[] = [];
      snapshot.forEach((doc) => {
        txs.push(doc.data() as StockTransaction);
      });
      txs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      callback(txs);
    }, (err) => {
      console.warn('Stock Transactions subscription error', err);
      callback([]);
    });
  } catch {
    callback([]);
    return () => {};
  }
}

export async function deleteStockTransaction(txId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, STOCK_TX_COL, txId));
  } catch (error) {
    console.error('Error deleting stock transaction:', error);
  }
}

// Company Settings
export function subscribeCompanySettings(callback: (settings: CompanySettings) => void) {
  try {
    return onSnapshot(doc(db, 'settings', 'company_profile'), (snapshot) => {
      if (snapshot.exists()) {
        callback(snapshot.data() as CompanySettings);
      } else {
        callback(initialCompanySettings);
      }
    }, () => callback(initialCompanySettings));
  } catch {
    callback(initialCompanySettings);
    return () => {};
  }
}

export async function saveCompanySettings(settings: CompanySettings): Promise<void> {
  try {
    const cleaned = cleanForFirestore(settings);
    await setDoc(doc(db, 'settings', 'company_profile'), cleaned, { merge: true });
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

// Backup & Import
export interface TransportBackupData {
  version: string;
  exportedAt: string;
  companyName?: string;
  invoices: Invoice[];
  parties: Party[];
  vehicles: Vehicle[];
  expenses: Expense[];
  products?: ProductItem[];
  stockTransactions?: StockTransaction[];
  notesReminders?: NoteReminder[];
  appUsers?: AppUserAccount[];
  settings?: CompanySettings;
}

export async function exportFirestoreBackup(fallbackData?: {
  invoices?: Invoice[];
  parties?: Party[];
  vehicles?: Vehicle[];
  expenses?: Expense[];
  products?: ProductItem[];
  stockTransactions?: StockTransaction[];
  notesReminders?: NoteReminder[];
  appUsers?: AppUserAccount[];
  settings?: CompanySettings;
}): Promise<TransportBackupData> {
  const fetchCol = async <T>(colName: string, fallback?: T[]): Promise<T[]> => {
    try {
      const snap = await getDocs(collection(db, colName));
      const items: T[] = [];
      snap.forEach(d => items.push(d.data() as T));
      if (items.length > 0) return items;
    } catch (err) {
      console.warn(`Firestore export read note for ${colName}:`, err);
    }
    return fallback || [];
  };

  const invoices = await fetchCol<Invoice>(INVOICES_COL, fallbackData?.invoices);
  const parties = await fetchCol<Party>(PARTIES_COL, fallbackData?.parties);
  const vehicles = await fetchCol<Vehicle>(VEHICLES_COL, fallbackData?.vehicles);
  const expenses = await fetchCol<Expense>(EXPENSES_COL, fallbackData?.expenses);
  const products = await fetchCol<ProductItem>(PRODUCTS_COL, fallbackData?.products);
  const stockTransactions = await fetchCol<StockTransaction>(STOCK_TX_COL, fallbackData?.stockTransactions);
  const notesReminders = await fetchCol<NoteReminder>(NOTES_REMINDERS_COL, fallbackData?.notesReminders);
  const appUsers = await fetchCol<AppUserAccount>(USERS_COL, fallbackData?.appUsers || getLocalUserAccounts());

  let companySettings = fallbackData?.settings || initialCompanySettings;
  try {
    const settingsSnap = await getDoc(doc(db, 'settings', 'company_profile'));
    if (settingsSnap.exists()) {
      companySettings = settingsSnap.data() as CompanySettings;
    }
  } catch {
    // Use fallback
  }

  return {
    version: '2.0',
    exportedAt: new Date().toISOString(),
    companyName: companySettings.companyName || 'Nirmala Transport',
    invoices,
    parties,
    vehicles,
    expenses,
    products,
    stockTransactions,
    notesReminders,
    appUsers,
    settings: companySettings,
  };
}

/**
 * Intelligent JSON normalizer for backups:
 * Parses standard backups, raw item arrays, legacy keys, or wrapped formats.
 */
export function normalizeBackupJson(raw: any): TransportBackupData {
  if (!raw) {
    throw new Error('Selected backup file is empty.');
  }

  // If raw is an array directly
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      throw new Error('The backup JSON array is empty.');
    }
    const first = raw[0] || {};
    if (first.invoiceNumber || first.salesBillNumber || first.purchaseBillNumber || first.billType || first.netPayable !== undefined || first.items) {
      return {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        invoices: raw,
        parties: [],
        vehicles: [],
        expenses: [],
        products: [],
        stockTransactions: [],
        notesReminders: [],
        appUsers: []
      };
    } else if (first.partyType || first.openingBalance !== undefined || first.closingBalance !== undefined || first.accountCategory) {
      return {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        invoices: [],
        parties: raw,
        vehicles: [],
        expenses: [],
        products: [],
        stockTransactions: [],
        notesReminders: [],
        appUsers: []
      };
    } else if (first.vehicleNumber || first.truckNumber || first.rcNumber) {
      return {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        invoices: [],
        parties: [],
        vehicles: raw,
        expenses: [],
        products: [],
        stockTransactions: [],
        notesReminders: [],
        appUsers: []
      };
    } else if (first.expenseType || first.category || first.fuelLiters || first.fuelRate) {
      return {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        invoices: [],
        parties: [],
        vehicles: [],
        expenses: raw,
        products: [],
        stockTransactions: [],
        notesReminders: [],
        appUsers: []
      };
    } else if (first.currentStock !== undefined || first.minStockLevel !== undefined || first.unit) {
      return {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        invoices: [],
        parties: [],
        vehicles: [],
        expenses: [],
        products: raw,
        stockTransactions: [],
        notesReminders: [],
        appUsers: []
      };
    }
    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      invoices: raw,
      parties: [],
      vehicles: [],
      expenses: [],
      products: [],
      stockTransactions: [],
      notesReminders: [],
      appUsers: []
    };
  }

  // Unwrap potential wrapper objects
  const root = (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) 
    ? raw.data 
    : (raw.backup && typeof raw.backup === 'object' && !Array.isArray(raw.backup))
    ? raw.backup
    : raw;

  // Extract Invoices / Bills
  const rawInvoices: any[] = [];
  if (Array.isArray(root.invoices)) rawInvoices.push(...root.invoices);
  if (Array.isArray(root.bills)) rawInvoices.push(...root.bills);
  if (Array.isArray(root.salesBills)) rawInvoices.push(...root.salesBills);
  if (Array.isArray(root.purchaseBills)) rawInvoices.push(...root.purchaseBills);
  if (Array.isArray(root.allInvoices)) rawInvoices.push(...root.allInvoices);

  // Extract Parties
  const rawParties: any[] = [];
  if (Array.isArray(root.parties)) rawParties.push(...root.parties);
  if (Array.isArray(root.customers)) rawParties.push(...root.customers);
  if (Array.isArray(root.vendors)) rawParties.push(...root.vendors);
  if (Array.isArray(root.consignors)) rawParties.push(...root.consignors);
  if (Array.isArray(root.allParties)) rawParties.push(...root.allParties);

  // Extract Vehicles
  const rawVehicles: any[] = [];
  if (Array.isArray(root.vehicles)) rawVehicles.push(...root.vehicles);
  if (Array.isArray(root.trucks)) rawVehicles.push(...root.trucks);
  if (Array.isArray(root.lorries)) rawVehicles.push(...root.lorries);
  if (Array.isArray(root.allVehicles)) rawVehicles.push(...root.allVehicles);

  // Extract Expenses
  const rawExpenses: any[] = [];
  if (Array.isArray(root.expenses)) rawExpenses.push(...root.expenses);
  if (Array.isArray(root.tripExpenses)) rawExpenses.push(...root.tripExpenses);
  if (Array.isArray(root.allExpenses)) rawExpenses.push(...root.allExpenses);

  // Extract Products
  const rawProducts: any[] = [];
  if (Array.isArray(root.products)) rawProducts.push(...root.products);
  if (Array.isArray(root.stockItems)) rawProducts.push(...root.stockItems);
  if (Array.isArray(root.stock)) rawProducts.push(...root.stock);

  // Extract Stock Transactions
  const rawStockTx: any[] = [];
  if (Array.isArray(root.stockTransactions)) rawStockTx.push(...root.stockTransactions);
  if (Array.isArray(root.stock_transactions)) rawStockTx.push(...root.stock_transactions);
  if (Array.isArray(root.transactions)) rawStockTx.push(...root.transactions);

  // Extract Notes & Reminders
  const rawNotes: any[] = [];
  if (Array.isArray(root.notesReminders)) rawNotes.push(...root.notesReminders);
  if (Array.isArray(root.notes_reminders)) rawNotes.push(...root.notes_reminders);
  if (Array.isArray(root.notes)) rawNotes.push(...root.notes);
  if (Array.isArray(root.reminders)) rawNotes.push(...root.reminders);

  // Extract Users
  const rawUsers: any[] = [];
  if (Array.isArray(root.appUsers)) rawUsers.push(...root.appUsers);
  if (Array.isArray(root.app_users)) rawUsers.push(...root.app_users);
  if (Array.isArray(root.users)) rawUsers.push(...root.users);
  if (Array.isArray(root.allUsers)) rawUsers.push(...root.allUsers);

  // Extract Settings
  const settings = root.settings || root.companySettings || root.company_profile || root.companyProfile || undefined;

  const dedupe = (arr: any[]) => {
    const seen = new Set<string>();
    return arr.filter(item => {
      if (!item || typeof item !== 'object') return false;
      const id = String(item.id || item.invoiceNumber || item.vehicleNumber || item.username || item.name || JSON.stringify(item));
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };

  const totalCount = rawInvoices.length + rawParties.length + rawVehicles.length + rawExpenses.length + 
                     rawProducts.length + rawStockTx.length + rawNotes.length + rawUsers.length + (settings ? 1 : 0);

  if (totalCount === 0) {
    throw new Error('No valid transport data (invoices, parties, vehicles, expenses, products, notes, or settings) was found in the selected JSON file.');
  }

  return {
    version: String(root.version || '1.0'),
    exportedAt: root.exportedAt || new Date().toISOString(),
    companyName: root.companyName || settings?.companyName || 'Nirmala Transport',
    invoices: dedupe(rawInvoices),
    parties: dedupe(rawParties),
    vehicles: dedupe(rawVehicles),
    expenses: dedupe(rawExpenses),
    products: dedupe(rawProducts),
    stockTransactions: dedupe(rawStockTx),
    notesReminders: dedupe(rawNotes),
    appUsers: dedupe(rawUsers),
    settings,
  };
}

export async function restoreFirestoreBackup(data: Partial<TransportBackupData>): Promise<{
  invoicesCount: number;
  partiesCount: number;
  vehiclesCount: number;
  expensesCount: number;
  productsCount: number;
  stockTransactionsCount: number;
  notesRemindersCount: number;
  usersCount: number;
  settingsUpdated: boolean;
  errors: string[];
}> {
  let invoicesCount = 0;
  let partiesCount = 0;
  let vehiclesCount = 0;
  let expensesCount = 0;
  let productsCount = 0;
  let stockTransactionsCount = 0;
  let notesRemindersCount = 0;
  let usersCount = 0;
  let settingsUpdated = false;
  const errors: string[] = [];

  const batchWriteItems = async <T extends Record<string, any>>(
    collectionName: string,
    items: T[] | undefined,
    idGenerator: (item: T) => string
  ): Promise<number> => {
    if (!Array.isArray(items) || items.length === 0) return 0;

    let saved = 0;
    const CHUNK_SIZE = 25;

    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      const chunkPromises = chunk.map(async (item) => {
        if (!item || typeof item !== 'object') return;
        const docId = sanitizeDocId(idGenerator(item), collectionName);
        const cleaned = cleanForFirestore({
          ...item,
          id: docId,
        });

        try {
          await setDoc(doc(db, collectionName, docId), cleaned, { merge: true });
          saved++;
        } catch (err: any) {
          console.warn(`Error writing to ${collectionName}/${docId}:`, err);
          errors.push(`${collectionName}/${docId}: ${err?.message || String(err)}`);
        }
      });

      await Promise.allSettled(chunkPromises);
    }
    return saved;
  };

  // 1. Invoices
  invoicesCount = await batchWriteItems(
    INVOICES_COL, 
    data.invoices, 
    (inv: any) => inv.id || inv.invoiceId || inv.invoiceNumber || inv.salesBillNumber || inv.purchaseBillNumber
  );

  // 2. Parties
  partiesCount = await batchWriteItems(
    PARTIES_COL, 
    data.parties, 
    (pty: any) => pty.id || pty.partyId || (pty.name ? `pty-${String(pty.name).toLowerCase().replace(/[^a-z0-9]/g, '-')}` : '')
  );

  // 3. Vehicles
  vehiclesCount = await batchWriteItems(
    VEHICLES_COL, 
    data.vehicles, 
    (veh: any) => veh.id || veh.vehicleId || (veh.vehicleNumber ? `veh-${String(veh.vehicleNumber).toLowerCase().replace(/[^a-z0-9]/g, '-')}` : '')
  );

  // 4. Expenses
  expensesCount = await batchWriteItems(
    EXPENSES_COL, 
    data.expenses, 
    (exp: any) => exp.id || exp.expenseId
  );

  // 5. Products
  productsCount = await batchWriteItems(
    PRODUCTS_COL, 
    data.products, 
    (prod: any) => prod.id || prod.productId || (prod.name ? `prod-${String(prod.name).toLowerCase().replace(/[^a-z0-9]/g, '-')}` : '')
  );

  // 6. Stock Transactions
  stockTransactionsCount = await batchWriteItems(
    STOCK_TX_COL, 
    data.stockTransactions, 
    (tx: any) => tx.id || tx.txId
  );

  // 7. Notes & Reminders
  notesRemindersCount = await batchWriteItems(
    NOTES_REMINDERS_COL, 
    data.notesReminders, 
    (note: any) => note.id || note.noteId
  );

  // 8. Users
  if (Array.isArray(data.appUsers) && data.appUsers.length > 0) {
    usersCount = await batchWriteItems(
      USERS_COL, 
      data.appUsers, 
      (u: any) => u.id || (u.username ? `user-${String(u.username).toLowerCase().replace(/[^a-z0-9]/g, '')}` : '')
    );
    // Sync local user cache
    const currentCached = getLocalUserAccounts();
    const mergedUsers = [...currentCached];
    for (const u of data.appUsers) {
      if (u && u.username) {
        const idx = mergedUsers.findIndex(m => m.username.toLowerCase() === u.username.toLowerCase());
        if (idx >= 0) {
          mergedUsers[idx] = { ...mergedUsers[idx], ...u };
        } else {
          mergedUsers.push(u);
        }
      }
    }
    saveLocalUserAccounts(mergedUsers);
  }

  // 9. Settings
  if (data.settings && typeof data.settings === 'object') {
    try {
      await setDoc(doc(db, 'settings', 'company_profile'), cleanForFirestore(data.settings), { merge: true });
      settingsUpdated = true;
    } catch (err: any) {
      console.warn('Error writing settings:', err);
      errors.push(`settings/company_profile: ${err?.message || String(err)}`);
    }
  }

  return {
    invoicesCount,
    partiesCount,
    vehiclesCount,
    expensesCount,
    productsCount,
    stockTransactionsCount,
    notesRemindersCount,
    usersCount,
    settingsUpdated,
    errors,
  };
}

// ==========================================
// User Accounts & Password Management
// ==========================================

const LOCAL_USERS_KEY = 'nirmala_app_users_v1';

export function getLocalUserAccounts(): AppUserAccount[] {
  try {
    const raw = localStorage.getItem(LOCAL_USERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to parse local user accounts:', e);
  }
  return initialAppUsers;
}

export function saveLocalUserAccounts(users: AppUserAccount[]): void {
  try {
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
  } catch (e) {
    console.warn('Failed to cache local user accounts:', e);
  }
}

export function subscribeUserAccounts(callback: (users: AppUserAccount[]) => void) {
  // Always emit local cache immediately
  const localCache = getLocalUserAccounts();
  callback(localCache);

  try {
    const q = query(collection(db, USERS_COL));
    return onSnapshot(q, (snapshot) => {
      if (snapshot.empty) {
        // If Firestore collection is empty, seed initial users
        initialAppUsers.forEach((u) => {
          setDoc(doc(db, USERS_COL, u.id), cleanForFirestore(u), { merge: true }).catch(() => {});
        });
        saveLocalUserAccounts(initialAppUsers);
        callback(initialAppUsers);
        return;
      }

      const usersList: AppUserAccount[] = [];
      snapshot.forEach((docSnap) => {
        usersList.push(docSnap.data() as AppUserAccount);
      });

      // Merge with initial users to ensure default admins always present
      for (const initU of initialAppUsers) {
        if (!usersList.some(u => u.username.toLowerCase() === initU.username.toLowerCase())) {
          usersList.push(initU);
        }
      }

      saveLocalUserAccounts(usersList);
      callback(usersList);
    }, (err) => {
      console.warn('Users subscription fallback to local cache:', err);
      callback(getLocalUserAccounts());
    });
  } catch (err) {
    console.warn('Firestore query error for users:', err);
    callback(getLocalUserAccounts());
    return () => {};
  }
}

export async function saveUserAccount(user: AppUserAccount): Promise<void> {
  const currentUsers = getLocalUserAccounts();
  const existingIdx = currentUsers.findIndex(u => u.id === user.id || u.username.toLowerCase() === user.username.toLowerCase());
  
  const updatedUser: AppUserAccount = {
    ...user,
    updatedAt: new Date().toISOString()
  };

  let updatedList: AppUserAccount[];
  if (existingIdx >= 0) {
    updatedList = [...currentUsers];
    updatedList[existingIdx] = updatedUser;
  } else {
    updatedList = [...currentUsers, updatedUser];
  }

  saveLocalUserAccounts(updatedList);

  try {
    await setDoc(doc(db, USERS_COL, user.id), cleanForFirestore(updatedUser), { merge: true });
  } catch (err) {
    console.warn('Firestore user save note (cached locally):', err);
  }
}

export async function deleteUserAccount(userId: string): Promise<void> {
  const currentUsers = getLocalUserAccounts();
  const filtered = currentUsers.filter(u => u.id !== userId);
  saveLocalUserAccounts(filtered);

  try {
    await deleteDoc(doc(db, USERS_COL, userId));
  } catch (err) {
    console.warn('Firestore user delete note:', err);
  }
}

/**
 * Changes a user's password with validation against current password if supplied.
 */
export async function changeUserPassword(
  usernameOrId: string,
  newPassword: string,
  currentPassword?: string
): Promise<{ success: boolean; message: string; user?: AppUserAccount }> {
  const cleanTarget = usernameOrId.trim().toLowerCase();
  const users = getLocalUserAccounts();
  
  const targetUser = users.find(u => 
    u.id.toLowerCase() === cleanTarget || 
    u.username.toLowerCase() === cleanTarget
  );

  if (!targetUser) {
    return {
      success: false,
      message: `User account "${usernameOrId}" was not found.`
    };
  }

  if (currentPassword !== undefined && currentPassword.trim() !== targetUser.password.trim()) {
    return {
      success: false,
      message: 'Current password does not match. Please verify and try again.'
    };
  }

  if (!newPassword || newPassword.trim().length < 4) {
    return {
      success: false,
      message: 'New password must be at least 4 characters long.'
    };
  }

  const updatedUser: AppUserAccount = {
    ...targetUser,
    password: newPassword.trim(),
    updatedAt: new Date().toISOString()
  };

  await saveUserAccount(updatedUser);

  return {
    success: true,
    message: `Password for "${targetUser.displayName}" (${targetUser.username}) updated successfully!`,
    user: updatedUser
  };
}

