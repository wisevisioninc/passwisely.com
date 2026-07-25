import React, { createContext, useContext, useState, useEffect } from "react";

interface TextContextType {
  inputText: string;
  setInputText: (text: string) => void;
}

// Make sure this is exported and structured as a class or singleton
export class TextStore {
  private static instance: TextStore;
  private _text: string = "";

  private constructor() {}

  static getInstance(): TextStore {
    if (!TextStore.instance) {
      console.log("Creating TextStore instance");
      TextStore.instance = new TextStore();
    }
    return TextStore.instance;
  }

  getText(): string {
    return this._text;
  }

  setText(value: string): void {
    console.log("TextStore setting:", value); // Debug
    this._text = value;
  }
}

export const textStore = TextStore.getInstance();

const TextContext = createContext<TextContextType | undefined>(undefined);

export const TextProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [inputText, setInputText] = useState("");

  const handleSetInputText = (text: string) => {
    setInputText(text);
    textStore.setText(text); // Update the store
  };

  return (
    <TextContext.Provider
      value={{ inputText, setInputText: handleSetInputText }}
    >
      {children}
    </TextContext.Provider>
  );
};

export const useText = () => {
  const context = useContext(TextContext);
  if (!context) {
    throw new Error("useText must be used within a TextProvider");
  }
  return context;
};
