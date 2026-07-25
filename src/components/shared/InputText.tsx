import { useText } from "../../contexts/TextContext";
import React, { ChangeEvent } from "react";

interface InputTextProps {
  placeholder?: string;
  label?: string;
  className?: string;
}

const InputText1: React.FC<InputTextProps> = ({
  placeholder = "",
  label,
  className = "",
}) => {
  const { inputText, setInputText } = useText();
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setInputText(event.target.value);
  };
  const testClick = () => {
    console.log("Test click");
    alert("Click working"); // This will be more visible than console.log
  };

  return (
    <div className="flex flex-col gap-2">
      <button onClick={testClick}>Test Button</button>
      <input
        type="text"
        value={inputText}
        onChange={handleChange}
        placeholder="Enter text"
        className="bg-white/10 rounded-md px-2 py-1 text-[11px] leading-none text-white/70"
      />
    </div>
  );
};
export default InputText1;
