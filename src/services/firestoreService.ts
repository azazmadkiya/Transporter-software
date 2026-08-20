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
 * Recursively removes keys with `undefined` values from objects or arrays
 * so Firestore `setDoc` / `updateDoc` never receives `undefined`.
 */
export function cleanForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return null as unknown as T;
  }
  if (Array.isArray(data)) {
    return data.map(item => cleanForFirestore(item)) as unknown as T;
  }
  if (typeof data === 'object' && !(data instanceof Date)) {
    const cleaned: Record<string, any> = {};
    for (const key of Object.keys(data)) {
      const val = (data as Record<string, any>)[key];
      if (val !== undefined) {
        cleaned[key] = cleanForFirestore(val);
      }
    }
    return cleaned as T;
  }
  return data;
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
  settings?: CompanySettings;
}

export async function exportFirestoreBackup(fallbackData?: {
  invoices?: Invoice[];
  parties?: Party[];
  vehicles?: Vehicle[];
  expenses?: Expense[];
  settings?: CompanySettings;
}): Promise<TransportBackupData> {
  try {
    const invSnap = await getDocs(collection(db, INVOICES_COL));
    const invoices: Invoice[] = [];
    invSnap.forEach((doc) => invoices.push(doc.data() as Invoice));

    const ptySnap = await getDocs(collection(db, PARTIES_COL));
    const parties: Party[] = [];
    ptySnap.forEach((doc) => parties.push(doc.data() as Party));

    const vehSnap = await getDocs(collection(db, VEHICLES_COL));
    const vehicles: Vehicle[] = [];
    vehSnap.forEach((doc) => vehicles.push(doc.data() as Vehicle));

    const expSnap = await getDocs(collection(db, EXPENSES_COL));
    const expenses: Expense[] = [];
    expSnap.forEach((doc) => expenses.push(doc.data() as Expense));

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
      version: '1.0',
      exportedAt: new Date().toISOString(),
      companyName: companySettings.companyName || 'Nirmala Transport',
      invoices: invoices.length > 0 ? invoices : (fallbackData?.invoices || []),
      parties: parties.length > 0 ? parties : (fallbackData?.parties || []),
      vehicles: vehicles.length > 0 ? vehicles : (fallbackData?.vehicles || []),
      expenses: expenses.length > 0 ? expenses : (fallbackData?.expenses || []),
      settings: companySettings,
    };
  } catch (err) {
    console.warn('Export from Firestore failed, using state fallback:', err);
    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      companyName: fallbackData?.settings?.companyName || 'Nirmala Transport',
      invoices: fallbackData?.invoices || [],
      parties: fallbackData?.parties || [],
      vehicles: fallbackData?.vehicles || [],
      expenses: fallbackData?.expenses || [],
      settings: fallbackData?.settings || initialCompanySettings,
    };
  }
}

export async function restoreFirestoreBackup(data: Partial<TransportBackupData>): Promise<{
  invoicesCount: number;
  partiesCount: number;
  vehiclesCount: number;
  expensesCount: number;
  settingsUpdated: boolean;
}> {
  let invoicesCount = 0;
  let partiesCount = 0;
  let vehiclesCount = 0;
  let expensesCount = 0;
  let settingsUpdated = false;

  if (Array.isArray(data.invoices)) {
    for (const inv of data.invoices) {
      if (inv && inv.id) {
        await setDoc(doc(db, INVOICES_COL, inv.id), cleanForFirestore(inv), { merge: true });
        invoicesCount++;
      }
    }
  }

  if (Array.isArray(data.parties)) {
    for (const pty of data.parties) {
      if (pty && pty.id) {
        await setDoc(doc(db, PARTIES_COL, pty.id), cleanForFirestore(pty), { merge: true });
        partiesCount++;
      }
    }
  }

  if (Array.isArray(data.vehicles)) {
    for (const veh of data.vehicles) {
      if (veh && veh.id) {
        await setDoc(doc(db, VEHICLES_COL, veh.id), cleanForFirestore(veh), { merge: true });
        vehiclesCount++;
      }
    }
  }

  if (Array.isArray(data.expenses)) {
    for (const exp of data.expenses) {
      if (exp && exp.id) {
        await setDoc(doc(db, EXPENSES_COL, exp.id), cleanForFirestore(exp), { merge: true });
        expensesCount++;
      }
    }
  }

  if (data.settings && typeof data.settings === 'object') {
    await setDoc(doc(db, 'settings', 'company_profile'), cleanForFirestore(data.settings), { merge: true });
    settingsUpdated = true;
  }

  return {
    invoicesCount,
    partiesCount,
    vehiclesCount,
    expensesCount,
    settingsUpdated,
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

