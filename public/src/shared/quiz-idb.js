const QUIZ_DB_NAME = "BasmagiQuizDB";
const QUIZ_DB_VERSION = 2;
const QUIZZES_STORE = "quizzes";
const META_STORE = "meta";
const STATIC_QUIZZES_STORE = "staticQuizzes";
const SUBSCRIBED_CATEGORIES_KEY = "subscribedCategories";

export async function openQuizIDB() {
  try {
    return await new Promise((resolve, reject) => {
      const request = indexedDB.open(QUIZ_DB_NAME, QUIZ_DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const oldVersion = event.oldVersion || 0;

        if (!db.objectStoreNames.contains(QUIZZES_STORE)) {
          const quizzesStore = db.createObjectStore(QUIZZES_STORE, {
            keyPath: "id",
          });
          quizzesStore.createIndex("by-category", "categoryKey", {
            unique: false,
          });
        } else {
          const quizzesStore = event.target.transaction.objectStore(QUIZZES_STORE);
          if (!quizzesStore.indexNames.contains("by-category")) {
            quizzesStore.createIndex("by-category", "categoryKey", {
              unique: false,
            });
          }
        }

        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "key" });
        }

        if (oldVersion < 2 && !db.objectStoreNames.contains(STATIC_QUIZZES_STORE)) {
          db.createObjectStore(STATIC_QUIZZES_STORE, { keyPath: "path" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          new Error(
            `IndexedDB open failed (${QUIZ_DB_NAME} v${QUIZ_DB_VERSION}): ${request.error?.message || "unknown error"}`,
          ),
        );
    });
  } catch (error) {
    throw new Error(`Failed to open quiz IndexedDB: ${error.message}`);
  }
}

export async function storeQuizInIDB(db, quizEntry) {
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(QUIZZES_STORE, "readwrite");
      const store = tx.objectStore(QUIZZES_STORE);
      store.put(quizEntry);

      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(
          new Error(
            `Failed to store quiz "${quizEntry?.id || "unknown"}": ${tx.error?.message || "transaction error"}`,
          ),
        );
      tx.onabort = () =>
        reject(
          new Error(
            `Store quiz transaction aborted for "${quizEntry?.id || "unknown"}": ${tx.error?.message || "transaction aborted"}`,
          ),
        );
    });
  } catch (error) {
    throw new Error(`Failed to store quiz in IndexedDB: ${error.message}`);
  }
}

export async function getQuizFromIDB(db, quizId) {
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(QUIZZES_STORE, "readonly");
      const store = tx.objectStore(QUIZZES_STORE);
      const request = store.get(quizId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () =>
        reject(
          new Error(
            `Failed to read quiz "${quizId}": ${request.error?.message || "request error"}`,
          ),
        );
    });
  } catch (error) {
    throw new Error(`Failed to get quiz from IndexedDB: ${error.message}`);
  }
}

export async function getQuizzesByCategoryFromIDB(db, catKey) {
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(QUIZZES_STORE, "readonly");
      const store = tx.objectStore(QUIZZES_STORE);
      const index = store.index("by-category");
      const request = index.getAll(catKey);

      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () =>
        reject(
          new Error(
            `Failed to read quizzes for category "${catKey}": ${request.error?.message || "request error"}`,
          ),
        );
    });
  } catch (error) {
    throw new Error(
      `Failed to get quizzes by category from IndexedDB: ${error.message}`,
    );
  }
}

export async function storeSubscribedCategories(db, keys) {
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      const store = tx.objectStore(META_STORE);
      store.put({
        key: SUBSCRIBED_CATEGORIES_KEY,
        value: Array.isArray(keys) ? keys : [],
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(
          new Error(
            `Failed to store subscribed categories: ${tx.error?.message || "transaction error"}`,
          ),
        );
      tx.onabort = () =>
        reject(
          new Error(
            `Store subscribed categories transaction aborted: ${tx.error?.message || "transaction aborted"}`,
          ),
        );
    });
  } catch (error) {
    throw new Error(
      `Failed to store subscribed categories in IndexedDB: ${error.message}`,
    );
  }
}

export async function getSubscribedCategoriesFromIDB(db) {
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const store = tx.objectStore(META_STORE);
      const request = store.get(SUBSCRIBED_CATEGORIES_KEY);

      request.onsuccess = () => {
        const result = request.result;
        resolve(Array.isArray(result?.value) ? result.value : []);
      };
      request.onerror = () =>
        reject(
          new Error(
            `Failed to read subscribed categories: ${request.error?.message || "request error"}`,
          ),
        );
    });
  } catch (error) {
    throw new Error(
      `Failed to get subscribed categories from IndexedDB: ${error.message}`,
    );
  }
}

export async function storeStaticQuizByPath(db, pathname, data) {
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STATIC_QUIZZES_STORE, "readwrite");
      const store = tx.objectStore(STATIC_QUIZZES_STORE);
      store.put({
        path: pathname,
        data,
        cachedAt: Date.now(),
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(
          new Error(
            `Failed to store static quiz "${pathname}": ${tx.error?.message || "transaction error"}`,
          ),
        );
      tx.onabort = () =>
        reject(
          new Error(
            `Store static quiz transaction aborted for "${pathname}": ${tx.error?.message || "transaction aborted"}`,
          ),
        );
    });
  } catch (error) {
    throw new Error(`Failed to store static quiz in IndexedDB: ${error.message}`);
  }
}

export async function getStaticQuizByPath(db, pathname) {
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STATIC_QUIZZES_STORE, "readonly");
      const store = tx.objectStore(STATIC_QUIZZES_STORE);
      const request = store.get(pathname);

      request.onsuccess = () => resolve(request.result?.data || null);
      request.onerror = () =>
        reject(
          new Error(
            `Failed to read static quiz "${pathname}": ${request.error?.message || "request error"}`,
          ),
        );
    });
  } catch (error) {
    throw new Error(`Failed to get static quiz from IndexedDB: ${error.message}`);
  }
}

export async function deleteQuizzesByCategory(db, categoryKey) {
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(QUIZZES_STORE, "readwrite");
      const store = tx.objectStore(QUIZZES_STORE);
      const index = store.index("by-category");
      const request = index.openCursor(IDBKeyRange.only(categoryKey));

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };

      request.onerror = () =>
        reject(
          new Error(
            `Failed to delete quizzes for category "${categoryKey}": ${request.error?.message || "request error"}`,
          ),
        );

      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(
          new Error(
            `Delete quizzes by category failed: ${tx.error?.message || "transaction error"}`,
          ),
        );
      tx.onabort = () =>
        reject(
          new Error(
            `Delete quizzes by category aborted: ${tx.error?.message || "transaction aborted"}`,
          ),
        );
    });
  } catch (error) {
    throw new Error(`Failed to delete quizzes by category: ${error.message}`);
  }
}

export async function deleteStaticQuizzesByPath(db, pathSubstring) {
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STATIC_QUIZZES_STORE, "readwrite");
      const store = tx.objectStore(STATIC_QUIZZES_STORE);
      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;

        if (typeof cursor.key === "string" && cursor.key.includes(pathSubstring)) {
          cursor.delete();
        }
        cursor.continue();
      };

      request.onerror = () =>
        reject(
          new Error(
            `Failed to delete static quizzes matching "${pathSubstring}": ${request.error?.message || "request error"}`,
          ),
        );

      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(
          new Error(
            `Delete static quizzes by path failed: ${tx.error?.message || "transaction error"}`,
          ),
        );
      tx.onabort = () =>
        reject(
          new Error(
            `Delete static quizzes by path aborted: ${tx.error?.message || "transaction aborted"}`,
          ),
        );
    });
  } catch (error) {
    throw new Error(`Failed to delete static quizzes by path: ${error.message}`);
  }
}

export async function clearQuizIDB() {
  let db;
  try {
    db = await openQuizIDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([QUIZZES_STORE, META_STORE], "readwrite");
      tx.objectStore(QUIZZES_STORE).clear();
      tx.objectStore(META_STORE).clear();

      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(
          new Error(
            `Failed to clear quiz IndexedDB stores: ${tx.error?.message || "transaction error"}`,
          ),
        );
      tx.onabort = () =>
        reject(
          new Error(
            `Clear quiz IndexedDB transaction aborted: ${tx.error?.message || "transaction aborted"}`,
          ),
        );
    });
  } catch (error) {
    throw new Error(`Failed to clear quiz IndexedDB: ${error.message}`);
  } finally {
    if (db) db.close();
  }
}
